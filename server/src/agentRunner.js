// This file is spawned as its own child process per run, so each run's
// activity shows up as its own running process with its own terminal output.
//
// Usage: node src/agentRunner.js <run_id>

import { supabase } from './lib/supabaseClient.js';
import { fetchOddsSnapshot } from './lib/txline.js';
import { evaluateSignal, computeStake } from './lib/strategyEngine.js';
import { reflectOnStrategy, shouldTriggerReflection } from './lib/llmReflection.js';
import { selfAdjust } from './lib/selfAdjust.js';

const runId = process.argv[2];
if (!runId) {
  console.error('Usage: node agentRunner.js <run_id>');
  process.exit(1);
}

const POLL_INTERVAL_MS = 5000;
const HALFTIME_MINUTE = 45;
const FULLTIME_MINUTE = 90;

const history = [];
let position = null; // { side, odds, stake, entryMinute } while a position is open
let lastTradeAt = 0; // ms timestamp of the last opened trade, used by 'cooldown' aggression
let signalStreak = { action: null, count: 0 }; // consecutive same-direction signals, used by 'confirmation' aggression
let peakBalance = null; // highest balance seen so far, used by the max-drawdown risk ceiling

function log(...args) {
  console.log(`[run ${runId}]`, ...args);
}

async function loadState() {
  const { data: run, error: runErr } = await supabase.from('agent_runs').select('*').eq('id', runId).single();
  if (runErr) throw new Error(`Failed to load run ${runId}: ${runErr.message}`);

  const { data: config, error: cfgErr } = await supabase.from('agents').select('*').eq('id', run.agent_id).single();
  if (cfgErr) throw new Error(`Failed to load agent ${run.agent_id}: ${cfgErr.message}`);

  return { ...config, ...run, agent_id: run.agent_id, run_id: run.id };
}

async function updateRun(fields) {
  const { error } = await supabase
    .from('agent_runs')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', runId);
  if (error) log('WARN: failed to update run row:', error.message);
}

async function recordTrade(agent, side, odds, stake, reason) {
  const { error } = await supabase.from('trades').insert({
    agent_id: agent.agent_id,
    run_id: runId,
    match_id: agent.match_id,
    side,
    odds,
    stake,
    reason,
  });
  if (error) log('WARN: failed to record trade:', error.message);
}

// Simple mark-to-market PnL: buying means betting the odds will shorten
// (price of the outcome goes up in probability terms); we approximate PnL
// as stake * (odds_at_entry / odds_now - 1) for a 'buy', inverse for 'sell'.
function markToMarket(entryOdds, currentOdds, side, stake) {
  const change =
    side === 'buy' ? (entryOdds - currentOdds) / entryOdds : (currentOdds - entryOdds) / entryOdds;
  return stake * change;
}

// Closes whatever position is currently open, realizes PnL into balance,
// records the trade, and clears the module-level `position` variable.
// Shared by all three exit rules (signal-reversal, stop-loss/take-profit, time-based).
async function closePosition(agent, snapshot, reason) {
  const realized = markToMarket(position.odds, snapshot.odds, position.side, position.stake);
  const newBalance = agent.balance + realized;
  const newRealizedTotal = (agent.realized_pnl ?? 0) + realized;
  log(
    `CLOSE ${position.side} stake=${position.stake} pnl=${realized.toFixed(2)} -> balance=${newBalance.toFixed(2)} reason=${reason}` 
  );
  await recordTrade(agent, `close_${position.side}`, snapshot.odds, position.stake, reason);
  await updateRun({
    balance: newBalance,
    realized_pnl: newRealizedTotal,
    unrealized_pnl: 0,
  });
  agent.balance = newBalance;
  agent.realized_pnl = newRealizedTotal;
  position = null;

  // K. Adaptivity: give self_adjusting/llm_reflective agents a chance to
  // revise their config now that a trade has actually closed.
  await maybeReflect(agent);
}

// Stop-loss / take-profit check. Returns whether the open position's current
// PnL% has breached either band, using agent.stop_loss / agent.take_profit
// (both expressed as percentages, e.g. 5 => 5%).
function checkStopLossTakeProfit(agent, currentOdds) {
  const pnlPct = markToMarket(position.odds, currentOdds, position.side, position.stake) / position.stake;
  const stopLoss = (agent.stop_loss ?? 5) / 100;
  const takeProfit = (agent.take_profit ?? 15) / 100;

  if (pnlPct <= -stopLoss) {
    return { exit: true, reason: `stop_loss:${(pnlPct * 100).toFixed(1)}%` };
  }
  if (pnlPct >= takeProfit) {
    return { exit: true, reason: `take_profit:${(pnlPct * 100).toFixed(1)}%` };
  }
  return { exit: false };
}

// Time-based exit: close at halftime if the position was opened in the first
// half, otherwise close at fulltime.
function checkTimeBasedExit(currentMinute) {
  const crossedHalftime = position.entryMinute < HALFTIME_MINUTE && currentMinute >= HALFTIME_MINUTE;
  const crossedFulltime = currentMinute >= FULLTIME_MINUTE;
  if (crossedHalftime) return { exit: true, reason: `time_based:halftime_min_${currentMinute}` };
  if (crossedFulltime) return { exit: true, reason: `time_based:fulltime_min_${currentMinute}` };
  return { exit: false };
}

// Aggression gate applied before opening a NEW position.
// 'instant'      -> always passes
// 'confirmation' -> requires 2+ consecutive ticks with the same signal direction
// 'cooldown'     -> requires cooldown_minutes to have elapsed since the last trade
function passesAggressionFilter(agent, decision, now) {
  const mode = agent.aggression || 'instant';

  if (mode === 'cooldown') {
    const cooldownMs = (agent.cooldown_minutes ?? 2) * 60 * 1000;
    if (now - lastTradeAt < cooldownMs) {
      const remainingSec = Math.ceil((cooldownMs - (now - lastTradeAt)) / 1000);
      return { pass: false, reason: `cooldown_active:${remainingSec}s_left` };
    }
    return { pass: true };
  }

  if (mode === 'confirmation') {
    if (signalStreak.action === decision.action) {
      signalStreak.count += 1;
    } else {
      signalStreak = { action: decision.action, count: 1 };
    }
    if (signalStreak.count < 2) {
      return { pass: false, reason: `awaiting_confirmation:${signalStreak.count}/2` };
    }
    return { pass: true };
  }

  // 'instant' (default): act on the first signal
  return { pass: true };
}

// H. Match-Phase Weighting: scales stake size up/down depending on match
// minute, or gates trading entirely for 'event_triggered' agents.
function getPhaseDecision(agent, snapshot) {
  const mode = agent.phase_weighting || 'uniform';
  const minute = snapshot.minute;

  if (mode === 'event_triggered') {
    // Dormant except around key events (goal / red card / etc).
    if (!snapshot.event) return { allow: false, multiplier: 0 };
    return { allow: true, multiplier: 1 };
  }

  if (mode === 'front_loaded') {
    if (minute <= 30) return { allow: true, multiplier: 1.5 };
    if (minute <= 60) return { allow: true, multiplier: 1.0 };
    return { allow: true, multiplier: 0.5 };
  }

  if (mode === 'back_loaded') {
    if (minute <= 30) return { allow: true, multiplier: 0.5 };
    if (minute <= 60) return { allow: true, multiplier: 1.0 };
    return { allow: true, multiplier: 1.5 };
  }

  // 'uniform' (default)
  return { allow: true, multiplier: 1 };
}

// L. Risk Ceiling: max exposure cap limits any single stake to a percentage
// of current balance, regardless of what the sizing strategy computed.
function applyExposureCap(agent, stake) {
  if (agent.max_exposure_pct == null) return stake;
  const maxStake = agent.balance * (agent.max_exposure_pct / 100);
  return Math.min(stake, maxStake);
}

// L. Risk Ceiling: max drawdown stop halts the agent entirely once balance
// has fallen more than max_drawdown_stop_pct off its peak.
async function checkMaxDrawdownStop(agent) {
  if (peakBalance === null) peakBalance = agent.balance;
  peakBalance = Math.max(peakBalance, agent.balance);

  if (agent.max_drawdown_stop_pct == null || peakBalance <= 0) return false;

  const drawdownPct = ((peakBalance - agent.balance) / peakBalance) * 100;
  if (drawdownPct >= agent.max_drawdown_stop_pct) {
    log(`RISK CEILING: drawdown ${drawdownPct.toFixed(1)}% >= max ${agent.max_drawdown_stop_pct}%, halting agent.`);
    await updateRun({ status: 'stopped' });
    return true;
  }
  return false;
}

// K. Adaptivity: after a trade closes, let self_adjusting/llm_reflective
// agents revise their own config based on performance so far.
// NOTE: winning/losing trade counts and average hold time are not tracked at
// the individual-trade level today (the trades table has no stored PnL per
// row), so this uses agent-level aggregates (realized_pnl, trade_count,
// balance) as a reasonable first pass rather than a full per-trade breakdown.
async function maybeReflect(agent) {
  if (!agent.adaptivity_mode || agent.adaptivity_mode === 'static') return;

  const shouldReflect = await shouldTriggerReflection(agent.agent_id, agent.last_reflection_timestamp, agent.trade_count);
  if (!shouldReflect) return;

  const { data: tradeLog, error } = await supabase
    .from('trades')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });

  if (error) {
    log('WARN: failed to load trade log for reflection:', error.message);
    return;
  }

  const roiPercent = agent.budget_cap ? ((agent.balance - agent.budget_cap) / agent.budget_cap) * 100 : 0;
  const drawdownPercent =
    peakBalance && peakBalance > 0 ? ((peakBalance - agent.balance) / peakBalance) * 100 : 0;

  const performanceSummary = {
    total_trades: agent.trade_count ?? 0,
    winning_trades: undefined, // not tracked per-trade; omitted rather than guessed
    losing_trades: undefined,
    realized_pnl: agent.realized_pnl ?? 0,
    unrealized_pnl: agent.unrealized_pnl ?? 0,
    final_balance: agent.balance,
    roi_percent: Number(roiPercent.toFixed(2)),
    avg_hold_time_minutes: undefined,
    max_drawdown_percent: Number(drawdownPercent.toFixed(2)),
  };

  let result;
  if (agent.adaptivity_mode === 'self_adjusting') {
    result = selfAdjust(agent, tradeLog || [], performanceSummary);
    if (result.success) {
      await supabase
        .from('agents')
        .update({
          odds_threshold: result.config.odds_threshold,
          stop_loss: result.config.stop_loss,
          last_reflection_timestamp: new Date().toISOString(),
        })
        .eq('id', agent.agent_id);
      log('adaptivity: self-adjust applied, thresholds updated.');
    } else {
      log(`adaptivity: self-adjust skipped: ${result.error}`);
    }
  } else {
    // llm_reflective
    if (!agent.llm_reflection_enabled) return;
    result = await reflectOnStrategy(agent.agent_id, agent, tradeLog || [], performanceSummary);
    if (result.success) {
      log('adaptivity: LLM reflection applied, config updated.');
    } else {
      log(`adaptivity: LLM reflection skipped/failed: ${result.error}`);
    }
  }
}

async function tick(agent) {
  const snapshot = await fetchOddsSnapshot(agent.match_id);
  history.push(snapshot);
  // Bound the window by *time*, not just count, so a large odds_timeframe
  // (up to 60 min) still has enough history to diff against. At a 5s poll
  // interval, 60 minutes = 720 ticks; cap generously above the max allowed
  // odds_timeframe rather than a flat 50.
  const MAX_HISTORY_TICKS = 800;
  if (history.length > MAX_HISTORY_TICKS) history.shift();

  log(`odds=${snapshot.odds} minute=${snapshot.minute} event=${snapshot.event ?? '-'}`);

  // L. Risk Ceiling: check max drawdown every tick, regardless of position state.
  const halted = await checkMaxDrawdownStop(agent);
  if (halted) return;

  // Update unrealized PnL if a position is open, and check rule-based exits
  // that must be evaluated every tick regardless of whether a new signal fires.
  if (position) {
    const unrealized = markToMarket(position.odds, snapshot.odds, position.side, position.stake);
    await updateRun({ unrealized_pnl: unrealized });

    const exitRule = agent.exit_rule;
    if (exitRule === 'stop-loss' || exitRule === 'stop_loss_take_profit') {
      const check = checkStopLossTakeProfit(agent, snapshot.odds);
      if (check.exit) {
        await closePosition(agent, snapshot, check.reason);
      }
    } else if (exitRule === 'time_based' && position) {
      const check = checkTimeBasedExit(snapshot.minute);
      if (check.exit) {
        await closePosition(agent, snapshot, check.reason);
      }
    }
  }

  const decision = evaluateSignal(agent, history);

  if (decision.action === 'hold') {
    // No signal this tick; a 'confirmation' streak must be consecutive, so reset it.
    signalStreak = { action: null, count: 0 };
    return;
  }

  // Exit an open position on signal-reversal exit rule
  if (position && agent.exit_rule === 'signal_reversal' && decision.action !== position.side) {
    await closePosition(agent, snapshot, decision.reason);
  }

  // Open a new position if none is open (one position at a time, kept simple)
  if (!position) {
    // I. Re-entry Rule: stop opening new trades once the cap is reached.
    if (agent.max_reentries != null && (agent.trade_count ?? 0) >= agent.max_reentries) {
      return;
    }

    // H. Match-Phase Weighting: gate (event_triggered) and/or scale stake size.
    const phase = getPhaseDecision(agent, snapshot);
    if (!phase.allow) return;

    const gate = passesAggressionFilter(agent, decision, Date.now());
    if (!gate.pass) {
      log(`skip open: ${gate.reason}`);
      return;
    }

    let stake = computeStake(agent, agent.balance, decision.confidence) * phase.multiplier;
    stake = applyExposureCap(agent, stake); // L. Risk Ceiling: max exposure cap
    if (stake <= 0 || stake > agent.balance) return;

    position = { side: decision.action, odds: snapshot.odds, stake, entryMinute: snapshot.minute };
    lastTradeAt = Date.now();
    signalStreak = { action: null, count: 0 };
    const newTradeCount = (agent.trade_count ?? 0) + 1;

    log(`OPEN ${decision.action} stake=${stake.toFixed(2)} @odds=${snapshot.odds} reason=${decision.reason}`);
    await recordTrade(agent, decision.action, snapshot.odds, stake, decision.reason);
    await updateRun({ trade_count: newTradeCount, status: 'running' });
    agent.trade_count = newTradeCount;
  }
}

async function main() {
  log('starting up...');
  let agent = await loadState();
  log(`loaded config: signal=${agent.signal_type} sizing=${agent.position_sizing} match=${agent.match_id} budget=${agent.budget_cap}`);
  peakBalance = agent.balance;

  await updateRun({ status: 'running', pid: process.pid });

  const interval = setInterval(async () => {
    try {
      agent = await loadState(); // refresh in case budget/status changed externally
      if (agent.status === 'stopped' || agent.status === 'inactive') {
        log('status=stopped, shutting down.');
        clearInterval(interval);
        process.exit(0);
      }
      await tick(agent);
    } catch (err) {
      log('ERROR during tick:', err.message);
      await updateRun({ status: 'error' });
    }
  }, POLL_INTERVAL_MS);

  process.on('SIGINT', async () => {
    log('received SIGINT, marking stopped.');
    await updateRun({ status: 'stopped' });
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`[run ${runId}] FATAL:`, err);
  process.exit(1);
});
