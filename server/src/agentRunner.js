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
const HALFTIME_MINUTE = 45;
const FULLTIME_MINUTE = 90;

const history = [];
const pendingSnapshots = []; // Reaction Latency: snapshots queued until agent.reaction_latency_ms has elapsed
let position = null; // { side, odds, stake, entryMinute } while a position is open
let lastTradeAt = 0; // ms timestamp of the last opened trade, used by 'cooldown' aggression
let signalStreak = { action: null, count: 0 }; // consecutive same-direction signals, used by 'confirmation' aggression
let peakBalance = null; // highest balance seen so far, used by the max-drawdown risk ceiling
let lastTradeResult = null; // 'win' | 'loss' | null — used by revenge_trader / martingale
let martingaleStreak = 0; // consecutive losses, used by risk_profile = 'martingale'
let fixtureDetails = null; // loaded once at startup for Context Awareness
let traderKeypair = null; // this run's on-chain wallet, loaded from agent.wallet_secret_key
let nextTradeId = 0; // increments per open_position call; PDA nonce for this trader+market

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

// Simple mark-to-market PnL: buying means betting the odds will shorten
// (price of the outcome goes up in probability terms); we approximate PnL
// as stake * (odds_at_entry / odds_now - 1) for a 'buy', inverse for 'sell'.
function markToMarket(entryOdds, currentOdds, side, stake) {
  const change =
    side === 'buy' ? (entryOdds - currentOdds) / entryOdds : (currentOdds - entryOdds) / entryOdds;
  return stake * change;
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

// Match-Phase Focus: scales stake size up/down depending on match
// minute, or gates trading entirely for 'event_triggered' agents.
function getPhaseDecision(agent, snapshot) {
  const mode = agent.phase_weighting || 'full_match';
  const minute = snapshot.minute;

  if (mode === 'early') {
    if (minute <= 20) return { allow: true, multiplier: 1.5 };
    return { allow: true, multiplier: 0.5 };
  }

  if (mode === 'pre_halftime') {
    if (minute > 20 && minute <= 45) return { allow: true, multiplier: 1.5 };
    return { allow: true, multiplier: 0.5 };
  }

  if (mode === 'second_half') {
    if (minute > 45 && minute <= 75) return { allow: true, multiplier: 1.5 };
    return { allow: true, multiplier: 0.5 };
  }

  if (mode === 'late_stoppage') {
    if (minute > 75) return { allow: true, multiplier: 1.5 };
    return { allow: true, multiplier: 0.5 };
  }

  // 'full_match' (default)
  return { allow: true, multiplier: 1 };
}

// L. Risk Ceiling: max exposure cap limits any single stake to a percentage
// of current balance, regardless of what the sizing strategy computed.
function applyExposureCap(agent, stake) {
  if (agent.max_exposure_pct == null) return stake;
  const maxStake = agent.balance * (agent.max_exposure_pct / 100);
  return Math.min(stake, maxStake);
}

// Reaction Latency: delays how long an agent takes to "see" a snapshot.
// Instant = 0ms, Fast = 2000-5000ms, Delayed = 15000-30000ms; the exact
// value lives in agent.reaction_latency_ms (validated in validateConfig.js).
// Implementation: push every real-time snapshot onto a queue immediately,
// but only return the oldest one once it's aged past reaction_latency_ms —
// so the agent trades against a snapshot that's `reaction_latency_ms` stale,
// simulating the delay between the real event and the agent noticing it.
function applyReactionLatency(agent, snapshot) {
  pendingSnapshots.push({ snapshot, seenAt: Date.now() });
  const latencyMs = agent.reaction_latency_ms ?? 3000;

  const now = Date.now();
  let ready = null;
  while (pendingSnapshots.length && now - pendingSnapshots[0].seenAt >= latencyMs) {
    ready = pendingSnapshots.shift().snapshot;
  }
  return ready; // null if nothing has aged past the latency window yet
}

// Side Bias: nudges confidence up when the decision aligns with the agent's
// declared side. Favorite/underdog is derived from the opening odds implied
// probability (Pct) rather than the live odds, so the bias doesn't drift
// mid-match as the market moves.
// [FEED-SHAPE TBD]: `Participant1IsHome` / opening `Pct` aren't in the
// current feed shape (see mockTxlineFeed.js / txline.js) — snapshots only
// carry a numeric `odds` for whichever single market is active. This uses
// the FIRST snapshot in `history` as a proxy for "opening odds" (lower
// odds = favorite) and assumes home is Participant1, both of which should
// be revisited once the real feed's participant/market fields are known.
let openingOdds = null;
let openingIsHomeFavorite = null;
function applySideBias(agent, decision, history) {
  const bias = agent.side_bias || 'none';
  if (bias === 'none' || decision.action === 'hold') return decision;

  if (openingOdds === null && history.length > 0) {
    openingOdds = history[0].odds;
    // odds < ~1.9 (even) implies favorite priced to win; treat 'buy' (home)
    // as the favorite side when opening odds were short.
    openingIsHomeFavorite = openingOdds < 1.9;
  }

  const backingHome = decision.action === 'buy';
  let aligned = false;
  if (bias === 'home') aligned = backingHome;
  else if (bias === 'away') aligned = !backingHome;
  else if (bias === 'favorite') aligned = backingHome === openingIsHomeFavorite;
  else if (bias === 'underdog') aligned = backingHome !== openingIsHomeFavorite;

  const adjustment = aligned ? 0.1 : -0.1;
  return { ...decision, confidence: Math.max(0, Math.min(1, decision.confidence + adjustment)) };
}

// Context Awareness: reads venue/weather/competition-tier once at startup
// and applies a flat confidence multiplier for the rest of the run if the
// agent has the relevant awareness flag enabled.
// [FEED-SHAPE TBD]: no fixture-details endpoint exists in this codebase yet
// (txline.js only exposes odds/score/minute/event). This reads from an
// optional FIXTURE_DETAILS env var / mock object until a real endpoint is
// wired up, so the hook is in place without blocking on the feed work.
async function loadContextAwareness(agent) {
  if (!agent.context_venue_aware && !agent.context_weather_aware && !agent.context_competition_tier_aware) {
    return { multiplier: 1 };
  }
  // Placeholder fixture details source — replace with a real TxLINE fixture-details call.
  fixtureDetails = process.env.MOCK_FIXTURE_DETAILS
    ? JSON.parse(process.env.MOCK_FIXTURE_DETAILS)
    : { venue: 'neutral', weather: 'clear', competitionTier: 'top' };

  let multiplier = 1;
  if (agent.context_venue_aware && fixtureDetails.venue === 'home_fortress') multiplier *= 1.1;
  if (agent.context_weather_aware && ['rain', 'storm'].includes(fixtureDetails.weather)) multiplier *= 0.9;
  if (agent.context_competition_tier_aware && fixtureDetails.competitionTier === 'lower') multiplier *= 0.85;
  return { multiplier };
}

// Wildcard Traits: small dispatch table, applied last, after every other
// filter/bias has already shaped `decision`.
function applyWildcardTrait(agent, decision, snapshot) {
  const trait = agent.wildcard_trait || 'none';
  if (trait === 'none' || decision.action === 'hold') return decision;

  switch (trait) {
    case 'chaos_agent':
      // Occasionally ignores its own model and trades on pure noise.
      if (Math.random() < 0.15) {
        return { ...decision, action: Math.random() < 0.5 ? 'buy' : 'sell', reason: 'chaos_agent:override' };
      }
      return decision;
    case 'comeback_romantic': {
      // Irrationally increases exposure to the trailing team as the game gets later.
      if (snapshot.minute < 60) return decision;
      const diff = (snapshot.score?.home ?? 0) - (snapshot.score?.away ?? 0);
      if (diff === 0) return decision;
      const trailingAction = diff > 0 ? 'sell' : 'buy'; // back the team that's behind
      return { ...decision, action: trailingAction, confidence: Math.min(1, decision.confidence + 0.2), reason: 'comeback_romantic:trailing_side' };
    }
    case 'revenge_trader':
      // After a losing trade, doubles down on the opposite side of its last call.
      if (lastTradeResult === 'loss' && position === null) {
        return { ...decision, action: decision.action === 'buy' ? 'sell' : 'buy', reason: 'revenge_trader:flip' };
      }
      return decision;
    case 'superstition': {
      // Lucky-number minute triggers an off-model trade regardless of signal.
      const luckyMinute = agent.__luckyMinute ?? (agent.__luckyMinute = 7 + Math.floor(Math.random() * 80));
      if (snapshot.minute === luckyMinute) {
        return { ...decision, action: Math.random() < 0.5 ? 'buy' : 'sell', confidence: 0.9, reason: `superstition:minute_${luckyMinute}` };
      }
      return decision;
    }
    case 'weather_prophet': {
      if (fixtureDetails && ['rain', 'storm'].includes(fixtureDetails.weather)) {
        return { ...decision, confidence: Math.min(1, decision.confidence + 0.3), reason: `${decision.reason}+weather_prophet` };
      }
      return decision;
    }
    case 'bandwagon': {
      // Copies whichever direction the market/odds are already moving, amplifying trends.
      const recent = history.slice(-3).map((h) => h.odds);
      if (recent.length < 2) return decision;
      const trendingDown = recent[recent.length - 1] < recent[0]; // odds shortening = money on home
      return { ...decision, action: trendingDown ? 'buy' : 'sell', reason: 'bandwagon:follow_trend' };
    }
    case 'contrarian': {
      // Deliberately fades the crowd/market-implied favorite regardless of signal.
      if (openingIsHomeFavorite === null) return decision;
      return { ...decision, action: openingIsHomeFavorite ? 'sell' : 'buy', reason: 'contrarian:fade_favorite' };
    }
    case 'last_minute_believer':
      // Dismisses everything before stoppage time; zeroes out phase.multiplier via the reason flag,
      // actual gating happens in tick() by checking snapshot.minute directly (see tick() diff below).
      return decision;
    default:
      return decision;
  }
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

async function tick(agent) {
  const rawSnapshot = await fetchOddsSnapshot(agent.match_id, agent);

  // Reaction Latency: hold the snapshot in a queue until it's aged past
  // agent.reaction_latency_ms before the agent is allowed to act on it.
  const snapshot = applyReactionLatency(agent, rawSnapshot);
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

  let decision = evaluateSignal(agent, history);

  if (decision.action !== 'hold') {
    decision = applySideBias(agent, decision, history);
    decision = applyWildcardTrait(agent, decision, snapshot);

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

    // Risk Profile: martingale reads the running loss streak; other profiles
    // pass through to the existing position_sizing-derived computeStake.
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
    const newBalance = await getWalletBalanceSol(traderKeypair.publicKey);

    log(`OPEN ${decision.action} stake=${stake.toFixed(4)} @odds=${snapshot.odds} balance=${newBalance.toFixed(4)} reason=${decision.reason} tx=${signature}`);
    await recordTrade(agent, decision.action, snapshot.odds, stake, decision.reason, null, newBalance, signature, snapshot.minute);
    await updateRun({ trade_count: newTradeCount, status: 'running', balance: newBalance });
    await updateAgentMetrics(agent.agent_id, {
      trade_count: newTradeCount,
      balance: newBalance,
    });
    agent.trade_count = newTradeCount;
    agent.balance = newBalance;
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

  // Balance is real chain state now, not whatever the DB row says -- sync
  // it once at startup so a restart doesn't reintroduce a phantom number.
  let chainBalance = await getWalletBalanceSol(traderKeypair.publicKey);
  agent.balance = chainBalance;
  await updateRun({ balance: chainBalance });
  await updateAgentMetrics(agent.agent_id, { balance: chainBalance });
  log(`trader wallet=${traderKeypair.publicKey.toBase58()} balance=${chainBalance.toFixed(4)} SOL`);

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
