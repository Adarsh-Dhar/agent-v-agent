// This file is spawned as its own child process per run, so each run's
// activity shows up as its own running process with its own terminal output.
//
// Usage: node src/agentRunner.js <run_id>

import { supabase } from './lib/supabaseClient.js';
import { fetchOddsSnapshot } from './lib/txline.js';
import { evaluateSignal, computeStake } from './lib/strategyEngine.js';
import { reflectOnStrategy, shouldTriggerReflection } from './lib/llmReflection.js';
import { selfAdjust } from './lib/selfAdjust.js';
import {
  markToMarket,
  checkStopLossTakeProfit,
  checkTimeBasedExit,
  passesAggressionFilter,
  getPhaseDecision,
  reachedMaxReentries,
  applyExposureCap,
  computeDrawdownStop,
  applyReactionLatency as applyReactionLatencyPure,
  applySideBias as applySideBiasPure,
  computeContextMultiplier,
  applyWildcardTrait as applyWildcardTraitPure,
} from './lib/agentDecisionRules.js';
import {
  keypairFromSecretArray,
  openPositionOnChain,
  closePositionOnChain,
  getWalletBalanceSol,
} from './lib/solanaClient.js';

const runId = process.argv[2];
if (!runId) {
  console.error('Usage: node agentRunner.js <run_id>');
  process.exit(1);
}

// Replay matches now advance one match-minute per real second (see
// txlineReplay.js TICK_INTERVAL_MS), so poll at the same 1s cadence or most
// minutes would never be observed. Live (non-replay) matches still just get
// a snapshot every second, which is harmless -- fetchOddsSnapshot has its
// own upstream rate limiting/caching for that path.
const POLL_INTERVAL_MS = 1000;

const history = [];
let pendingSnapshots = []; // Reaction Latency: snapshots queued until agent.reaction_latency_ms has elapsed
let position = null; // { side, odds, stake, entryMinute } while a position is open
let lastTradeAt = 0; // ms timestamp of the last opened trade, used by 'cooldown' aggression
let signalStreak = { action: null, count: 0 }; // consecutive same-direction signals, used by 'confirmation' aggression
let peakBalance = null; // highest balance seen so far, used by the max-drawdown risk ceiling
let lastTradeResult = null; // 'win' | 'loss' | null — used by revenge_trader / martingale
let martingaleStreak = 0; // consecutive losses, used by risk_profile = 'martingale'
let fixtureDetails = null; // loaded once at startup for Context Awareness
let traderKeypair = null; // this run's on-chain wallet, loaded from agent.wallet_secret_key
let nextTradeId = 0; // increments per open_position call; PDA nonce for this trader+market
let matchEnded = false; // set by tick() when the feed reports the match is over; checked by main()'s poll loop

function log(...args) {
  console.log(`[run ${runId}]`, ...args);
}

async function loadState() {
  const { data: run, error: runErr } = await supabase.from('agent_runs').select('*').eq('id', runId).single();
  if (runErr) {
    // PGRST116 = row not found (deleted by PATCH stop); PGRST121 = multiple rows returned
    if (runErr.code === 'PGRST116' || runErr.code === 'PGRST121') {
      log(`run row ${runErr.code === 'PGRST116' ? 'deleted' : 'duplicated'} — exiting cleanly.`);
      process.exit(0);
    }
    throw new Error(`Failed to load run ${runId}: ${runErr.message}`);
  }

  if (run.status === 'stopped' || run.status === 'inactive') {
    log(`status=${run.status}, shutting down.`);
    process.exit(0);
  }

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

async function updateAgentMetrics(agentId, fields) {
  const { error } = await supabase
    .from('agents')
    .update(fields)
    .eq('id', agentId);
  if (error) log('WARN: failed to update agent row:', error.message);
}

// Persist the live odds/score/minute feed so the frontend can show "what's
// happening in the match right now" independent of whether any agent
// actually traded on this tick. For live matches we encode seconds into
// the minute field (minute*100+seconds) so every tick gets its own unique
// row. The frontend decodes this back to the real minute for display.
// For replay matches we use the real minute directly — duplicate minutes
// are silently ignored (the match_ticks_replay_dedup partial index ensures
// one row per replay minute).
async function recordMatchTick(matchId, snapshot) {
  const isReplay = matchId?.startsWith('replay-');

  const storeMinute = isReplay
    ? snapshot.minute
    : snapshot.minute * 100 + Math.floor((Date.now() / 1000) % 60);

  const { error } = await supabase.from('match_ticks').insert({
    match_id: matchId,
    minute: storeMinute,
    odds: snapshot.odds,
    score_home: snapshot.score?.home ?? null,
    score_away: snapshot.score?.away ?? null,
    event: snapshot.event ?? null,
  });
  // Duplicate key errors are expected for replays (same minute inserted
  // multiple times due to tick rate) — ignore them silently.
  if (error && error.code !== '23505') log('WARN: failed to record match tick:', error.message);
}

async function recordTrade(agent, side, odds, stake, reason, pnl = null, balanceAfter = null, txSignature = null, matchMinute = null) {
  const { error } = await supabase.from('trades').insert({
    agent_id: agent.agent_id,
    run_id: runId,
    match_id: agent.match_id,
    side,
    odds,
    stake,
    reason,
    pnl,
    balance_after: balanceAfter,
    tx_signature: txSignature,
    match_minute: matchMinute,
  });
  if (error) log('WARN: failed to record trade:', error.message);
}

// Closes whatever position is currently open. The actual PnL calculation
// and fund movement (vault -> trader) now happens on-chain in
// close_position -- this just submits the exit odds, then reads the
// trader wallet's real post-close balance back rather than computing a
// number in JS. `markToMarket` is still used elsewhere purely for
// *decisions* (stop-loss/take-profit thresholds, unrealized-PnL display);
// it no longer has any say over what balance actually gets persisted.
// Shared by all three exit rules (signal-reversal, stop-loss/take-profit, time-based).
async function closePosition(agent, snapshot, reason) {
  const balanceBefore = agent.balance;
  const { tradeId, side, stake } = position;

  let signature;
  let newBalance;
  let realized;

  try {
    ({ signature } = await closePositionOnChain({
      matchId: agent.match_id,
      traderPubkey: traderKeypair.publicKey,
      tradeId,
      exitOdds: snapshot.odds,
    }));
  } catch (err) {
    log(`ERROR: close_position on-chain call failed, leaving position open: ${err.message}`);
    return;
  }

  newBalance = await getWalletBalanceSol(traderKeypair.publicKey);
  realized = newBalance - balanceBefore;

  const newRealizedTotal = (agent.realized_pnl ?? 0) + realized;

  // Track the last close's outcome for revenge_trader / martingale, both of
  // which condition their next action on whether the just-closed trade won.
  lastTradeResult = realized >= 0 ? 'win' : 'loss';
  martingaleStreak = realized < 0 ? martingaleStreak + 1 : 0;

  log(
    `CLOSE ${side} stake=${stake} pnl=${realized.toFixed(4)} -> balance=${newBalance.toFixed(4)} reason=${reason} tx=${signature}`
  );
  await recordTrade(agent, `close_${side}`, snapshot.odds, stake, reason, realized, newBalance, signature);
  await updateRun({
    balance: newBalance,
    realized_pnl: newRealizedTotal,
    unrealized_pnl: 0,
  });
  await updateAgentMetrics(agent.agent_id, {
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

// Side Bias: opening state tracked for applySideBiasPure + wildcard contrarian.
let openingState = { openingOdds: null, openingIsHomeFavorite: null };

// Context Awareness: reads venue/weather/competition-tier once at startup
// and applies a flat confidence multiplier for the rest of the run if the
// agent has the relevant awareness flag enabled.
// [FEED-SHAPE TBD]: no fixture-details endpoint exists in this codebase yet
// (txline.js only exposes odds/score/minute/event). This reads from an
// optional FIXTURE_DETAILS env var / mock object until a real endpoint is
// wired up, so the hook is in place without blocking on the feed work.
async function loadContextAwareness(agent) {
  // Placeholder fixture details source — replace with a real TxLINE fixture-details call.
  const fd = process.env.MOCK_FIXTURE_DETAILS
    ? JSON.parse(process.env.MOCK_FIXTURE_DETAILS)
    : { venue: 'neutral', weather: 'clear', competitionTier: 'top' };
  fixtureDetails = fd;

  const multiplier = computeContextMultiplier(agent, fd);
  return { multiplier };
}

// L. Risk Ceiling: max drawdown stop halts the agent entirely once balance
// has fallen more than max_drawdown_stop_pct off its peak.
async function checkMaxDrawdownStop(agent) {
  const { halt, peakBalance: newPeak, drawdownPct } = computeDrawdownStop(agent, peakBalance);
  peakBalance = newPeak;
  if (halt) {
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
          reaction_latency_ms: result.config.reaction_latency_ms,
          decision_style: result.config.decision_style,
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

// Match end: close any open position at the final odds, mark this run and
// the agent as 'completed' (not just 'stopped', so it's visually distinct
// from a manual/risk-ceiling stop), flip the shared `matches` row to
// 'completed', and push the final balance/pnl into match_players directly
// so the leaderboard is correct even if nobody has the match page open at
// the moment the match ends (the frontend's own sync only fires while
// someone is polling GET /api/matches/:code).
async function closeOutMatch(agent, snapshot) {
  log(`match ended at minute=${snapshot.minute}, closing out.`);

  if (position) {
    await closePosition(agent, snapshot, 'match_ended');
  }

  await updateRun({ status: 'completed' });
  await updateAgentMetrics(agent.agent_id, { status: 'completed' });

  const { data: matchRow, error: matchErr } = await supabase
    .from('matches')
    .select('id')
    .eq('agent_match_id', agent.match_id)
    .maybeSingle();

  if (matchErr) {
    log('WARN: failed to look up matches row for completion:', matchErr.message);
    return;
  }
  if (!matchRow) return; // not every match_id (e.g. ad-hoc/test runs) has a matches row

  await supabase.from('matches').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', matchRow.id);

  const { error: playerErr } = await supabase
    .from('match_players')
    .update({ purse: agent.balance, pnl: agent.realized_pnl ?? 0 })
    .eq('match_id', matchRow.id)
    .eq('agent_id', agent.agent_id);
  if (playerErr) log('WARN: failed to sync final purse/pnl to match_players:', playerErr.message);
}

async function tick(agent) {
  const rawSnapshot = await fetchOddsSnapshot(agent.match_id, agent);

  // Match end (replay hit the last timeline tick, or live feed reported
  // game_finalised): close out immediately on the raw snapshot rather than
  // waiting for it to age through the reaction-latency queue, then signal
  // the poll loop in main() to stop.
  if (rawSnapshot.is_finished || rawSnapshot.matchEnded) {
    await recordMatchTick(agent.match_id, rawSnapshot);
    await closeOutMatch(agent, rawSnapshot);
    matchEnded = true;
    return;
  }

  // Reaction Latency: hold the snapshot in a queue until it's aged past
  // agent.reaction_latency_ms before the agent is allowed to act on it.
  const { ready: snapshot, pendingSnapshots: updatedQueue } = applyReactionLatencyPure(agent, rawSnapshot, pendingSnapshots);
  pendingSnapshots = updatedQueue;
  if (!snapshot) return; // nothing has aged into the agent's reaction window yet

  history.push(snapshot);
  // Bound the window to a reasonable size for score-state reasoning and
  // decision evaluation. Cap at 800 ticks to prevent unbounded memory growth.
  const MAX_HISTORY_TICKS = 800;
  if (history.length > MAX_HISTORY_TICKS) history.shift();

  log(`odds=${snapshot.odds} minute=${snapshot.minute} event=${snapshot.event ?? '-'}`);
  await recordMatchTick(agent.match_id, snapshot);
  if (fixtureDetails === null) {
    const ctx = await loadContextAwareness(agent);
    agent.__contextMultiplier = ctx.multiplier;
  }

  // L. Risk Ceiling: check max drawdown every tick, regardless of position state.
  const halted = await checkMaxDrawdownStop(agent);
  if (halted) return;

  // Update unrealized PnL if a position is open, and check rule-based exits
  // that must be evaluated every tick regardless of whether a new signal fires.
  if (position) {
    // Off-chain estimate for the UI only (same formula the contract uses),
    // so the leaderboard has a live number between ticks without an RPC
    // call every 5s. The authoritative PnL is whatever close_position pays
    // out on-chain when the position actually closes.
    const unrealized = markToMarket(position.odds, snapshot.odds, position.side, position.stake);
    await updateRun({ unrealized_pnl: unrealized });

    const exitRule = agent.exit_rule;
    if (exitRule === 'stop-loss' || exitRule === 'stop_loss_take_profit') {
      const check = checkStopLossTakeProfit(position, agent, snapshot.odds);
      if (check.exit) {
        await closePosition(agent, snapshot, check.reason);
      }
    } else if (exitRule === 'time_based' && position) {
      const check = checkTimeBasedExit(position, snapshot.minute);
      if (check.exit) {
        await closePosition(agent, snapshot, check.reason);
      }
    }
  }

  let decision = evaluateSignal(agent, history);

  if (decision.action !== 'hold') {
    const sb = applySideBiasPure(agent, decision, history, openingState);
    decision = sb.decision;
    openingState = sb.openingState;
    if ((agent.wildcard_trait || 'none') === 'superstition' && !agent.__luckyMinute) {
      agent.__luckyMinute = 7 + Math.floor(Math.random() * 80);
    }
    decision = applyWildcardTraitPure(agent, decision, snapshot, history, {
      lastTradeResult,
      position,
      openingIsHomeFavorite: openingState.openingIsHomeFavorite,
      fixtureDetails,
      luckyMinute: agent.__luckyMinute,
    });

    // last_minute_believer: dismiss everything before stoppage time.
    if ((agent.wildcard_trait || 'none') === 'last_minute_believer' && snapshot.minute < 90) {
      decision = { action: 'hold', reason: 'last_minute_believer:waiting_for_stoppage', confidence: 0 };
    }
  }

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
    if (reachedMaxReentries(agent)) {
      return;
    }

    // H. Match-Phase Weighting: gate (event_triggered) and/or scale stake size.
    const phase = getPhaseDecision(agent, snapshot);
    if (!phase.allow) return;

    const gate = passesAggressionFilter(agent, decision, Date.now(), lastTradeAt, signalStreak);
    if (!gate.pass) {
      log(`skip open: ${gate.reason}`);
      return;
    }
    signalStreak = gate.signalStreak;

    // Risk Profile: martingale reads the running loss streak and overrides
    // computeStake's normal position_sizing switch entirely (see
    // strategyEngine.js). Other profiles pass through unchanged.
    const agentForStake =
      agent.risk_profile === 'martingale' ? { ...agent, __martingaleStreak: martingaleStreak } : agent;
    let stake =
      computeStake(agentForStake, agent.balance, decision.confidence) *
      phase.multiplier *
      (agent.__contextMultiplier ?? 1);
    stake = applyExposureCap(agent, stake); // L. Risk Ceiling: max exposure cap
    if (stake <= 0 || stake > agent.balance) return;

    const tradeId = nextTradeId;
    let signature;

    try {
      ({ signature } = await openPositionOnChain({
        traderKeypair,
        matchId: agent.match_id,
        tradeId,
        side: decision.action,
        stakeSol: stake,
        entryOdds: snapshot.odds,
      }));
    } catch (err) {
      log(`ERROR: open_position on-chain call failed, skipping trade: ${err.message}`);
      return;
    }
    nextTradeId += 1;

    position = { side: decision.action, odds: snapshot.odds, stake, entryMinute: snapshot.minute, tradeId };
    lastTradeAt = Date.now();
    signalStreak = { action: null, count: 0 };
    const newTradeCount = (agent.trade_count ?? 0) + 1;

    log(`OPEN ${decision.action} stake=${stake.toFixed(4)} @odds=${snapshot.odds} balance=${agent.balance.toFixed(4)} reason=${decision.reason} tx=${signature}`);
    await recordTrade(agent, decision.action, snapshot.odds, stake, decision.reason, null, agent.balance, signature, snapshot.minute);
    await updateRun({ trade_count: newTradeCount, status: 'running' });
    await updateAgentMetrics(agent.agent_id, {
      trade_count: newTradeCount,
    });
    agent.trade_count = newTradeCount;
  }
}

async function main() {
  log('starting up...');
  let agent = await loadState();
  log(`loaded config: decision_style=${agent.decision_style} market_focus=${agent.market_focus} sizing=${agent.position_sizing} match=${agent.match_id} budget=${agent.budget_cap}`);

  // Every run gets a real funded wallet. Load the keypair from DB.
  if (!agent.wallet_secret_key) {
    throw new Error(`run ${runId} has no wallet_secret_key -- was it created via POST /agents/:id/run?`);
  }
  traderKeypair = keypairFromSecretArray(agent.wallet_secret_key);

  // Resume trade_id numbering where the last run left off, in case this
  // process restarted mid-run (trade_count only increments on OPEN, so it
  // equals the next unused nonce for this trader+market).
  nextTradeId = agent.trade_count ?? 0;

  // Balance is authoritative in the DB (set to budget_cap on run creation,
  // only updated on CLOSE). Don't overwrite with chain wallet balance at
  // startup — when a position is open, the wallet balance is lower than
  // actual equity (SOL is locked in the position PDA).
  const chainBalance = await getWalletBalanceSol(traderKeypair.publicKey);
  log(`trader wallet=${traderKeypair.publicKey.toBase58()} wallet_balance=${chainBalance.toFixed(4)} SOL db_balance=${agent.balance}`);

  peakBalance = agent.balance;

  await updateRun({ status: 'running', pid: process.pid });

  const interval = setInterval(async () => {
    try {
      agent = await loadState(); // refresh in case budget/status changed externally (may process.exit)
      if (!agent) {
        clearInterval(interval);
        process.exit(0);
      }
      await tick(agent);
      if (matchEnded) {
        log('match completed, shutting down.');
        clearInterval(interval);
        process.exit(0);
      }
    } catch (err) {
      log('ERROR during tick:', err.message);
      await updateRun({ status: 'error' });
      // Without this, a bad/missing replay fixture (or any other tick
      // failure) fails silently from the frontend's point of view -- the
      // terminal log just sits on "waiting for the first tick" forever
      // with no indication why. Write a visible error line into the same
      // feed the frontend already polls.
      await recordMatchTick(agent.match_id, {
        minute: history.length ? history[history.length - 1].minute : 0,
        odds: null,
        score: null,
        event: `error:${err.message.slice(0, 200)}`,
      });
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
