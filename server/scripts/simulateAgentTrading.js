#!/usr/bin/env node
/**
 * simulateAgentTrading.js
 *
 * Runs one or more in-memory agents against the same mock Argentina vs
 * Switzerland feed (src/lib/mockTxlineFeed.js) and simulates realistic
 * buy/sell trading + mark-to-market PnL, using the EXACT same decision
 * logic as production (evaluateSignal / computeStake from strategyEngine.js).
 *
 * This is intentionally DB-free and crypto-free: no Supabase, no on-chain
 * settlement. Balances, positions, and trades all live in memory for the
 * duration of the run, then a summary/leaderboard is printed. Swap this out
 * for agentRunner.js + Supabase + txline.js later without touching the
 * strategy logic — it's the same evaluateSignal/computeStake calls either way.
 *
 * Usage:
 *   node scripts/simulateAgentTrading.js
 *   node scripts/simulateAgentTrading.js --agents 4 --budget 1000
 *   node scripts/simulateAgentTrading.js --agents 3 --speed 10        // 10x faster than real time
 *   node scripts/simulateAgentTrading.js --config ./my-agent.json     // run one exact config instead of random
 *   node scripts/simulateAgentTrading.js --quiet                      // suppress per-tick logs, just show summary
 */

import fs from 'fs';
import { createMockArgentinaSwitzerlandFeed } from '../src/lib/mockTxlineFeed.js';
import { evaluateSignal, computeStake } from '../src/lib/strategyEngine.js';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : def;
}
const NUM_AGENTS = args.includes('--config') ? 1 : parseInt(argVal('agents', '3'), 10);
const BUDGET = parseFloat(argVal('budget', '1000'));
const SPEED = parseFloat(argVal('speed', '1')); // 1 = real time (matches runMockFeed.js), >1 = faster
const CONFIG_PATH = argVal('config', null);
const QUIET = args.includes('--quiet');
// 'aggressive' (default) = highly sensitive, frequently-trading, profit-tuned configs.
// 'random' = the original fully-randomized factor generator (kept for comparison/testing).
const PROFILE = argVal('profile', 'aggressive');

const MATCH_REAL_MS = 121 * 1000; // same total as runMockFeed.js
const DURATION_MS = MATCH_REAL_MS; // scripted match timeline length (unaffected by playback speed)
const TICK_MS = Math.max(50, Math.round(1000 / SPEED)); // wall-clock gap between ticks

const HALFTIME_MINUTE = 45;
const FULLTIME_MINUTE = 90;

// ---------------------------------------------------------------------------
// Random strategy config generator (mirrors scripts/createRandomAgent.js's
// FACTORS so simulated agents are exactly as varied as the ones the app
// actually spawns).
// ---------------------------------------------------------------------------
const FACTORS = {
  market_focus: ['1x2', 'asian_handicap', 'over_under', 'multi_market'],
  decision_style: ['volatility_breakout'],
  confirmation_tolerance: ['aggressive', 'conservative', 'adaptive'],
  score_state_mode: ['favor_chasing', 'favor_leading', 'momentum_only'],
  side_bias: ['home', 'away', 'favorite', 'underdog', 'none'],
  risk_profile: ['conservative', 'aggressive', 'martingale', 'flat_stake'],
  position_sizing: ['fixed', 'percent_of_budget', 'confidence_weighted'],
  exit_rule: ['stop-loss', 'time_based', 'signal_reversal'],
  aggression: ['instant', 'confirmation', 'cooldown'],
  direction_bias: ['long_only', 'short_only', 'bidirectional'],
  phase_weighting: ['early', 'pre_halftime', 'second_half', 'late_stoppage', 'full_match'],
  reentry_rule: ['no_reentry', 'immediate_reentry', 'capped_reentry'],
  wildcard_trait: ['none', 'chaos_agent', 'comeback_romantic', 'revenge_trader', 'superstition', 'weather_prophet', 'bandwagon', 'contrarian', 'last_minute_believer'],
};
const SCORE_STATE_EVENTS = ['goal_home', 'goal_away', 'red_card_away', 'red_card_home'];

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
// Weighted choice: pass [[value, weight], ...]. Lets a profile lean toward
// certain options (e.g. more 'instant' than 'cooldown') without eliminating
// the rest of the option space - that's what keeps agents individually
// distinct instead of collapsing to one hardcoded combo.
function weightedChoice(pairs) {
  const total = pairs.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [value, w] of pairs) {
    if ((r -= w) <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}

function generateRandomConfig() {
  const marketFocus = randomChoice(FACTORS.market_focus);
  const decisionStyle = randomChoice(FACTORS.decision_style);
  const confirmationTolerance = randomChoice(FACTORS.confirmation_tolerance);
  const scoreStateMode = randomChoice(FACTORS.score_state_mode);
  const sideBias = randomChoice(FACTORS.side_bias);
  const riskProfile = randomChoice(FACTORS.risk_profile);
  const sizing = randomChoice(FACTORS.position_sizing);
  const exit = randomChoice(FACTORS.exit_rule);
  const aggression = randomChoice(FACTORS.aggression);
  const direction = randomChoice(FACTORS.direction_bias);
  const phaseWeighting = randomChoice(FACTORS.phase_weighting);
  const reentryRule = randomChoice(FACTORS.reentry_rule);
  const maxReentries =
    reentryRule === 'no_reentry' ? 1 : reentryRule === 'immediate_reentry' ? null : randomInt(2, 10);
  const reactionLatency = randomInt(0, 30000);
  const wildcardTrait = randomChoice(FACTORS.wildcard_trait);

  const config = {
    market_focus: marketFocus,
    decision_style: decisionStyle,
    confirmation_tolerance: confirmationTolerance,
    score_state_mode: scoreStateMode,
    side_bias: sideBias,
    risk_profile: riskProfile,
    position_sizing: sizing,
    exit_rule: exit,
    aggression,
    direction_bias: direction,
    phase_weighting: phaseWeighting,
    reentry_rule: reentryRule,
    max_reentries: maxReentries,
    reaction_latency_ms: reactionLatency,
    wildcard_trait: wildcardTrait,
    max_exposure_pct: randomInt(20, 50),
    max_drawdown_stop_pct: randomInt(15, 40),
  };

  if (marketFocus === 'asian_handicap') {
    config.ah_line_band = randomChoice(['tight', 'deep']);
  }
  if (marketFocus === 'over_under') {
    config.ou_line_band = randomChoice(['low', 'mid', 'high']);
  }

  if (sizing === 'fixed') {
    config.fixed_stake = (Math.random() * 0.09 + 0.01).toFixed(4); // 0.01 to 0.1 SOL
  } else if (sizing === 'percent_of_budget' || sizing === 'percentage' || sizing === 'confidence_weighted') {
    config.percentage_stake = randomInt(5, 20);
  }

  if (exit === 'stop-loss' || exit === 'stop_loss_take_profit') {
    config.stop_loss = randomInt(3, 10);
    config.take_profit = randomInt(10, 25);
  }

  if (aggression === 'cooldown') {
    config.cooldown_minutes = randomInt(1, 5);
  }

  return config;
}

// ---------------------------------------------------------------------------
// Aggressive / high-frequency / profit-tuned config generator.
//
// Why the old random generator traded so rarely:
//  - 'score_state' + phase_weighting='event_triggered' only ever allows a
//    trade on the exact tick an event fires (goal/red card) - a handful of
//    times per match at best.
//  - direction_bias long_only/short_only silently drops half of all signals
//    (e.g. a short_only agent can never act on a home goal).
//  - odds_threshold of 5-10% is large relative to the feed's per-tick jitter
//    (~1-3%), so 'odds-movement'/'momentum'/'volatility_spike' signals rarely
//    cross the bar outside of the big event-driven odds jumps.
//  - reentry_rule='no_reentry' (or a low capped_reentry) plus a tight
//    max_drawdown_stop_pct means an agent can lock itself out for the rest
//    of the match after one or two trades.
//
// This profile fixes all of that: it reacts to small odds moves, allows
// both directions, re-enters continuously, and sizes stake by signal
// confidence so it leans in harder on strong moves without over-betting on
// weak ones.
// ---------------------------------------------------------------------------
function generateAggressiveConfig() {
  // volatility_breakout is the only decision style still wired up.
  const DECISION_STYLES = ['volatility_breakout'];
  const decisionStyle = randomChoice(DECISION_STYLES);

  // Every factor below is randomized (weighted, not hardcoded) so agents stay
  // individually distinct - the earlier version pinned sizing/exit/aggression/
  // direction/phase/reentry identically for every agent, which meant "profile
  // aggressive" agents only differed by decision_style. Weights lean toward the
  // options that trade often and cut losers fast (that was the original
  // intent) without collapsing the other options out of the space entirely.
  const sizing = weightedChoice([
    ['confidence_weighted', 5],
    ['percent_of_budget', 3],
    ['fixed', 2],
  ]);
  const exit = weightedChoice([
    ['signal_reversal', 5],
    ['stop-loss', 3],
    ['time_based', 2],
  ]);
  const aggression = weightedChoice([
    ['instant', 7],
    ['cooldown', 2],
    ['confirmation', 1],
  ]);
  const direction = weightedChoice([
    ['bidirectional', 10],
    ['long_only', 1],
    ['short_only', 1],
  ]);
  const phaseWeighting = weightedChoice([
    ['full_match', 6],
    ['early', 2],
    ['pre_halftime', 2],
    ['second_half', 2],
    ['late_stoppage', 2],
  ]);
  const reentryRule = weightedChoice([
    ['immediate_reentry', 8],
    ['capped_reentry', 2],
    ['no_reentry', 0],
  ]);
  const maxReentries =
    reentryRule === 'no_reentry' ? 1 : reentryRule === 'immediate_reentry' ? null : randomInt(3, 12);

  const config = {
    market_focus: '1x2', // aggressive profile defaults to 1x2 for simplicity
    decision_style: decisionStyle,
    confirmation_tolerance: 'aggressive',
    score_state_mode: 'momentum_only',
    side_bias: 'none',
    risk_profile: 'aggressive',
    position_sizing: sizing,
    exit_rule: exit,
    aggression,
    direction_bias: direction,
    phase_weighting: phaseWeighting,
    reentry_rule: reentryRule,
    max_reentries: maxReentries,
    reaction_latency_ms: randomInt(0, 3000), // fast reaction for aggressive profile
    wildcard_trait: 'none',
    // Risk ceiling (L): most agents get an exposure cap and/or drawdown stop,
    // but a slice run with no ceiling at all, so 'none' stays a real option
    // instead of every agent always carrying both caps.
    max_exposure_pct: Math.random() < 0.85 ? randomInt(25, 50) : null,
    max_drawdown_stop_pct: Math.random() < 0.8 ? randomInt(25, 50) : null,
  };

  if (sizing === 'fixed') {
    config.fixed_stake = randomInt(80, 220);
  } else {
    // Used by both percent_of_budget and confidence_weighted (as a ceiling
    // for the latter: stake = balance * percentage_stake * confidence).
    config.percentage_stake = randomInt(12, 25);
  }

  if (exit === 'stop-loss') {
    config.stop_loss = randomInt(3, 10);
    config.take_profit = randomInt(10, 25);
  }

  if (aggression === 'cooldown') {
    config.cooldown_minutes = randomInt(1, 4);
  } else if (aggression === 'confirmation') {
    config.confirmation_count = 2;
  }

  // A: optional wildcard trait - about 1 in 10 agents get a wildcard trait
  // for irrational behavior patterns.
  if (Math.random() < 0.1) {
    const wildcardOptions = FACTORS.wildcard_trait.filter((t) => t !== 'none');
    config.wildcard_trait = randomChoice(wildcardOptions);
  }

  return config;
}

// ---------------------------------------------------------------------------
// Mark-to-market PnL (identical formula to agentRunner.js)
// ---------------------------------------------------------------------------
function markToMarket(entryOdds, currentOdds, side, stake) {
  const change = side === 'buy' ? (entryOdds - currentOdds) / entryOdds : (currentOdds - entryOdds) / entryOdds;
  return stake * change;
}

// ---------------------------------------------------------------------------
// Agent factory: bundles config + in-memory portfolio state + the same
// per-tick decision flow agentRunner.js runs, minus any DB/network calls.
// ---------------------------------------------------------------------------
function makeAgent(name, config, budget) {
  return {
    name,
    config,
    budget,
    balance: budget,
    realizedPnl: 0,
    unrealizedPnl: 0,
    tradeCount: 0,
    trades: [], // { side, odds, stake, reason, minute, pnl? }
    position: null, // { side, odds, stake, entryMinute }
    lastTradeAt: 0,
    signalStreak: { action: null, count: 0 },
    peakBalance: budget,
    maxDrawdownPct: 0,
    halted: false,
    maxReentriesWarned: false,
  };
}

function log(agent, ...msg) {
  if (!QUIET) console.log(`[${agent.name}]`, ...msg);
}

function recordTrade(agent, side, odds, stake, reason, minute, pnl) {
  agent.trades.push({ side, odds, stake, reason, minute, pnl });
}

function checkStopLossTakeProfit(agent, currentOdds) {
  const { position, config } = agent;
  const pnlPct = markToMarket(position.odds, currentOdds, position.side, position.stake) / position.stake;
  const stopLoss = (config.stop_loss ?? 5) / 100;
  const takeProfit = (config.take_profit ?? 15) / 100;
  if (pnlPct <= -stopLoss) return { exit: true, reason: `stop_loss:${(pnlPct * 100).toFixed(1)}%` };
  if (pnlPct >= takeProfit) return { exit: true, reason: `take_profit:${(pnlPct * 100).toFixed(1)}%` };
  return { exit: false };
}

function checkTimeBasedExit(agent, currentMinute) {
  const crossedHalftime = agent.position.entryMinute < HALFTIME_MINUTE && currentMinute >= HALFTIME_MINUTE;
  const crossedFulltime = currentMinute >= FULLTIME_MINUTE;
  if (crossedHalftime) return { exit: true, reason: `time_based:halftime_min_${currentMinute}` };
  if (crossedFulltime) return { exit: true, reason: `time_based:fulltime_min_${currentMinute}` };
  return { exit: false };
}

function passesAggressionFilter(agent, decision, now) {
  const mode = agent.config.aggression || 'instant';

  if (mode === 'cooldown') {
    const cooldownMs = (agent.config.cooldown_minutes ?? 2) * 60 * 1000;
    if (now - agent.lastTradeAt < cooldownMs) {
      return { pass: false, reason: `cooldown_active` };
    }
    return { pass: true };
  }

  if (mode === 'confirmation') {
    if (agent.signalStreak.action === decision.action) {
      agent.signalStreak.count += 1;
    } else {
      agent.signalStreak = { action: decision.action, count: 1 };
    }
    if (agent.signalStreak.count < 2) {
      return { pass: false, reason: `awaiting_confirmation:${agent.signalStreak.count}/2` };
    }
    return { pass: true };
  }

  return { pass: true }; // 'instant'
}

function getPhaseDecision(agent, snapshot) {
  const mode = agent.config.phase_weighting || 'full_match';
  const minute = snapshot.minute;

  if (mode === 'early') {
    if (minute <= 20) return { allow: true, multiplier: 1.5 };
    return { allow: true, multiplier: 0.5 };
  }
  if (mode === 'pre_halftime') {
    if (minute <= 45) return { allow: true, multiplier: 1.5 };
    return { allow: true, multiplier: 0.5 };
  }
  if (mode === 'second_half') {
    if (minute > 45 && minute <= 75) return { allow: true, multiplier: 1.5 };
    return { allow: true, multiplier: 0.5 };
  }
  if (mode === 'late_stoppage') {
    if (minute >= 75) return { allow: true, multiplier: 1.5 };
    return { allow: true, multiplier: 0.5 };
  }
  return { allow: true, multiplier: 1 }; // full_match
}

function applyExposureCap(agent, stake) {
  if (agent.config.max_exposure_pct == null) return stake;
  const maxStake = agent.balance * (agent.config.max_exposure_pct / 100);
  return Math.min(stake, maxStake);
}

function checkMaxDrawdownStop(agent) {
  agent.peakBalance = Math.max(agent.peakBalance, agent.balance);
  if (agent.peakBalance <= 0) return false;
  const drawdownPct = ((agent.peakBalance - agent.balance) / agent.peakBalance) * 100;
  agent.maxDrawdownPct = Math.max(agent.maxDrawdownPct, drawdownPct);
  if (agent.config.max_drawdown_stop_pct == null) return false;
  if (drawdownPct >= agent.config.max_drawdown_stop_pct) {
    log(agent, `RISK CEILING: drawdown ${drawdownPct.toFixed(1)}% >= max ${agent.config.max_drawdown_stop_pct}%, halting.`);
    agent.halted = true;
    return true;
  }
  return false;
}

function closePosition(agent, snapshot, reason) {
  const realized = markToMarket(agent.position.odds, snapshot.odds, agent.position.side, agent.position.stake);
  agent.balance += realized;
  agent.realizedPnl += realized;
  log(
    agent,
    `CLOSE ${agent.position.side} stake=${agent.position.stake.toFixed(2)} pnl=${realized >= 0 ? '+' : ''}${realized.toFixed(2)} -> balance=${agent.balance.toFixed(2)} reason=${reason}` 
  );
  recordTrade(agent, `close_${agent.position.side}`, snapshot.odds, agent.position.stake, reason, snapshot.minute, realized);
  agent.unrealizedPnl = 0;
  agent.position = null;
}

function tickAgent(agent, history, snapshot, now) {
  if (agent.halted) return;

  if (checkMaxDrawdownStop(agent)) return;

  if (agent.position) {
    agent.unrealizedPnl = markToMarket(agent.position.odds, snapshot.odds, agent.position.side, agent.position.stake);

    const exitRule = agent.config.exit_rule;
    if (exitRule === 'stop-loss' || exitRule === 'stop_loss_take_profit') {
      const check = checkStopLossTakeProfit(agent, snapshot.odds);
      if (check.exit) closePosition(agent, snapshot, check.reason);
    } else if (exitRule === 'time_based' && agent.position) {
      const check = checkTimeBasedExit(agent, snapshot.minute);
      if (check.exit) closePosition(agent, snapshot, check.reason);
    }
  }

  const decision = evaluateSignal(agent.config, history);

  if (decision.action === 'hold') {
    agent.signalStreak = { action: null, count: 0 };
    return;
  }

  // Debug: log why signals are blocked
  if (!agent.position && decision.action !== 'hold' && !agent.maxReentriesWarned) {
    log(agent, `SIGNAL ${decision.action} reason=${decision.reason} confidence=${decision.confidence.toFixed(2)}`);
  }

  if (agent.position && agent.config.exit_rule === 'signal_reversal' && decision.action !== agent.position.side) {
    closePosition(agent, snapshot, decision.reason);
  }

  if (!agent.position) {
    if (agent.config.max_reentries != null && agent.tradeCount >= agent.config.max_reentries) {
      if (!agent.maxReentriesWarned) {
        log(agent, `BLOCKED: max_reentries reached (${agent.tradeCount}/${agent.config.max_reentries}) - will not log further signals`);
        agent.maxReentriesWarned = true;
      }
      return;
    }

    const phase = getPhaseDecision(agent, snapshot);
    if (!phase.allow) {
      log(agent, `BLOCKED: phase_weighting=${agent.config.phase_weighting} allow=false`);
      return;
    }

    const gate = passesAggressionFilter(agent, decision, now);
    if (!gate.pass) {
      log(agent, `BLOCKED: aggression=${agent.config.aggression} reason=${gate.reason}`);
      return;
    }

    let stake = computeStake(agent.config, agent.balance, decision.confidence) * phase.multiplier;
    stake = applyExposureCap(agent, stake);
    if (stake <= 0 || stake > agent.balance) {
      log(agent, `BLOCKED: stake=${stake.toFixed(2)} invalid (balance=${agent.balance.toFixed(2)})`);
      return;
    }

    agent.position = { side: decision.action, odds: snapshot.odds, stake, entryMinute: snapshot.minute };
    agent.lastTradeAt = now;
    agent.signalStreak = { action: null, count: 0 };
    agent.tradeCount += 1;

    log(agent, `OPEN ${decision.action} stake=${stake.toFixed(2)} @odds=${snapshot.odds} reason=${decision.reason}`);
    recordTrade(agent, decision.action, snapshot.odds, stake, decision.reason, snapshot.minute, undefined);
  }
}

// ---------------------------------------------------------------------------
// Setup agents
// ---------------------------------------------------------------------------
let agents;
if (CONFIG_PATH) {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  agents = [makeAgent(config.name || 'agent-custom', config, config.budget_cap ?? BUDGET)];
} else {
  agents = Array.from({ length: NUM_AGENTS }, (_, i) => {
    const config = PROFILE === 'random' ? generateRandomConfig() : generateAggressiveConfig();
    return makeAgent(`agent-${i + 1}:${config.decision_style}`, config, BUDGET);
  });
}

console.log('='.repeat(78));
console.log('Agent-vs-Agent trading simulation — mock Argentina vs Switzerland feed');
console.log(`${agents.length} agent(s) · budget=${BUDGET} each · playback speed=${SPEED}x · profile=${PROFILE}`);
console.log('='.repeat(78));
agents.forEach((a) => {
  console.log(`\n${a.name}`);
  console.log('  ' + JSON.stringify(a.config));
});
console.log('\nStarting...\n');

// ---------------------------------------------------------------------------
// Drive the feed. Shared history array — every agent evaluates against the
// exact same odds tape, same as they would in a real shared match.
// ---------------------------------------------------------------------------
const tick = createMockArgentinaSwitzerlandFeed({ durationMs: DURATION_MS });
const history = [];

const interval = setInterval(async () => {
  const snapshot = await tick();
  history.push(snapshot);
  const MAX_HISTORY_TICKS = 800;
  if (history.length > MAX_HISTORY_TICKS) history.shift();

  if (!QUIET) {
    console.log(`\n[${snapshot.minute}'] odds=${snapshot.odds.toFixed(3)} score=${snapshot.score.home}-${snapshot.score.away} event=${snapshot.event || '-'} period=${snapshot.period}`);
  }

  const now = Date.now();
  for (const agent of agents) {
    tickAgent(agent, history, snapshot, now);
  }

  if (snapshot.matchEnded) {
    clearInterval(interval);
    finish(snapshot);
  }
}, TICK_MS);

// ---------------------------------------------------------------------------
// Final summary / leaderboard
// ---------------------------------------------------------------------------
function finish(finalSnapshot) {
  // Force-close anything still open at the final price so PnL is fully realized.
  for (const agent of agents) {
    if (agent.position) {
      closePosition(agent, finalSnapshot, 'match_ended');
    }
  }

  console.log('\n' + '='.repeat(78));
  console.log('FINAL RESULTS');
  console.log('='.repeat(78));

  const rows = agents.map((a) => {
    const closed = a.trades.filter((t) => t.pnl !== undefined);
    const wins = closed.filter((t) => t.pnl > 0).length;
    const losses = closed.filter((t) => t.pnl <= 0).length;
    const roiPct = ((a.balance - a.budget) / a.budget) * 100;
    return {
      name: a.name,
      signal: a.config.decision_style,
      trades: a.tradeCount,
      wins,
      losses,
      winRate: closed.length ? `${((wins / closed.length) * 100).toFixed(0)}%` : 'n/a',
      startBalance: a.budget.toFixed(2),
      finalBalance: a.balance.toFixed(2),
      pnl: a.realizedPnl.toFixed(2),
      roi: `${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(2)}%`,
      maxDrawdown: `${a.maxDrawdownPct.toFixed(1)}%`,
      halted: a.halted ? 'HALTED' : '',
    };
  });

  rows.sort((a, b) => parseFloat(b.roi) - parseFloat(a.roi));

  console.table(rows);

  const winner = rows[0];
  if (winner) {
    console.log(`\n🏆 Best performer: ${winner.name} (${winner.roi}, ${winner.trades} trades, ${winner.winRate} win rate)`);
  }
  console.log('\nNote: synthetic feed + mark-to-market PnL, no real money/exchange involved.');
}

process.on('SIGINT', () => {
  clearInterval(interval);
  console.log('\n\nInterrupted — showing results so far...');
  finish(history[history.length - 1] || { odds: 2.0, minute: 0 });
  process.exit(0);
});