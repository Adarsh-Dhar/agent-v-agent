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
  signal: ['odds-movement', 'score_state', 'mean_reversion', 'momentum', 'time_decay', 'volatility_spike'],
  position_sizing: ['fixed', 'percent_of_budget', 'confidence_weighted'],
  exit_rule: ['stop-loss', 'time_based', 'signal_reversal'],
  aggression: ['instant', 'confirmation', 'cooldown'],
  direction_bias: ['long_only', 'short_only', 'bidirectional'],
  phase_weighting: ['uniform', 'front_loaded', 'back_loaded', 'event_triggered'],
  reentry_rule: ['no_reentry', 'immediate_reentry', 'capped_reentry'],
};
const SCORE_STATE_EVENTS = ['goal_home', 'goal_away', 'red_card_away', 'red_card_home'];

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRandomConfig() {
  const signal = randomChoice(FACTORS.signal);
  const sizing = randomChoice(FACTORS.position_sizing);
  const exit = randomChoice(FACTORS.exit_rule);
  const aggression = randomChoice(FACTORS.aggression);
  const direction = randomChoice(FACTORS.direction_bias);
  const phaseWeighting = randomChoice(FACTORS.phase_weighting);
  const reentryRule = randomChoice(FACTORS.reentry_rule);
  const maxReentries =
    reentryRule === 'no_reentry' ? 1 : reentryRule === 'immediate_reentry' ? null : randomInt(2, 10);

  const config = {
    signal_type: signal,
    position_sizing: sizing,
    exit_rule: exit,
    aggression,
    direction_bias: direction,
    phase_weighting: phaseWeighting,
    reentry_rule: reentryRule,
    max_reentries: maxReentries,
    max_exposure_pct: randomInt(20, 50),
    max_drawdown_stop_pct: randomInt(15, 40),
  };

  if (signal === 'odds-movement' || signal === 'odds_movement' || signal === 'mean_reversion' || signal === 'momentum' || signal === 'volatility_spike') {
    config.odds_threshold = randomInt(2, 10);
    config.odds_timeframe = randomInt(2, 10);
  }
  if (signal === 'score_state') {
    // pick 1-3 trigger events this agent reacts to
    const n = randomInt(1, 3);
    config.score_state_triggers = [...SCORE_STATE_EVENTS].sort(() => Math.random() - 0.5).slice(0, n);
  }

  if (sizing === 'fixed') {
    config.fixed_stake = randomInt(50, 200);
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
  const mode = agent.config.phase_weighting || 'uniform';
  const minute = snapshot.minute;

  if (mode === 'event_triggered') {
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
  return { allow: true, multiplier: 1 }; // uniform
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

  if (agent.position && agent.config.exit_rule === 'signal_reversal' && decision.action !== agent.position.side) {
    closePosition(agent, snapshot, decision.reason);
  }

  if (!agent.position) {
    if (agent.config.max_reentries != null && agent.tradeCount >= agent.config.max_reentries) return;

    const phase = getPhaseDecision(agent, snapshot);
    if (!phase.allow) return;

    const gate = passesAggressionFilter(agent, decision, now);
    if (!gate.pass) return;

    let stake = computeStake(agent.config, agent.balance, decision.confidence) * phase.multiplier;
    stake = applyExposureCap(agent, stake);
    if (stake <= 0 || stake > agent.balance) return;

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
    const config = generateRandomConfig();
    return makeAgent(`agent-${i + 1}:${config.signal_type}`, config, BUDGET);
  });
}

console.log('='.repeat(78));
console.log('Agent-vs-Agent trading simulation — mock Argentina vs Switzerland feed');
console.log(`${agents.length} agent(s) · budget=${BUDGET} each · playback speed=${SPEED}x`);
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

const interval = setInterval(() => {
  const snapshot = tick();
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
      signal: a.config.signal_type,
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
