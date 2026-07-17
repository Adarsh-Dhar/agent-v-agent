#!/usr/bin/env node
/**
 * scripts/replayLoggedFeed.js
 *
 * Backtests agent configs against REAL logged TxLINE data instead of the
 * synthetic mock feed simulateAgentTrading.js uses. Reuses the exact same
 * decision logic (evaluateSignal/computeStake from strategyEngine.js) and
 * the exact same mark-to-market/open/close engine simulateAgentTrading.js
 * uses, so results are directly comparable -- the only thing that changes
 * is where the odds/score ticks come from.
 *
 * DATA SOURCES (checked in this order):
 *   1. logs/txline-odds-*.jsonl + logs/txline-scores-*.jsonl
 *      -- the CORRECT source. Produced by `node scripts/logTxlineData.js
 *      --match-id <fixtureId> --poll 15` while a match is actually live.
 *      Each line is one real poll: {"kind":"odds","fetched_at":...,"data":[...]}.
 *   2. fra-esp-logs.txt (or --fra-esp-file <path>)
 *      -- fetchFraEsp.js's pretty single-snapshot format. fetchFraEsp.js
 *      OVERWRITES this file every run, so it can only ever hold ONE tick.
 *      That's not enough for evaluateSignal (needs >=2 ticks of history),
 *      so this path exists mainly to fail loudly and tell you what to do
 *      instead, not to actually produce trades.
 *
 * Usage:
 *   node scripts/replayLoggedFeed.js --fixture 18237038
 *   node scripts/replayLoggedFeed.js --fixture 18237038 --agents 4
 *   node scripts/replayLoggedFeed.js --fixture 18237038 --config ./my-agent.json
 *   node scripts/replayLoggedFeed.js --fra-esp-file ./fra-esp-logs.txt
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { evaluateSignal, computeStake } from '../src/lib/strategyEngine.js';
import { resolveMarketOdds, extractLatestScoreState } from '../src/lib/txline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');

const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : def;
}
const FIXTURE_ID = argVal('fixture', null);
const FRA_ESP_FILE = argVal('fra-esp-file', path.join(ROOT, 'fra-esp-logs.txt'));
const NUM_AGENTS = args.includes('--config') ? 1 : parseInt(argVal('agents', '3'), 10);
const BUDGET = parseFloat(argVal('budget', '1000'));
const CONFIG_PATH = argVal('config', null);
const QUIET = args.includes('--quiet');

function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function findLatestLogFile(kind) {
  if (!fs.existsSync(LOG_DIR)) return null;
  const files = fs
    .readdirSync(LOG_DIR)
    .filter((f) => f.startsWith(`txline-${kind}-`) && f.endsWith('.jsonl'))
    .sort();
  return files.map((f) => path.join(LOG_DIR, f));
}

function loadFromJsonlLogs(fixtureId) {
  const oddsFiles = findLatestLogFile('odds');
  const scoresFiles = findLatestLogFile('scores');
  if (!oddsFiles || oddsFiles.length === 0) return null;

  const oddsEntries = oddsFiles.flatMap(loadJsonl);
  const scoresEntries = scoresFiles ? scoresFiles.flatMap(loadJsonl) : [];
  const usableOdds = oddsEntries.filter((e) => Array.isArray(e.data) && e.data.length > 0);

  if (usableOdds.length === 0) {
    return { ticks: [], totalOddsPolls: oddsEntries.length, emptyPolls: oddsEntries.length };
  }

  const marketFocus = argVal('market-focus', '1x2');
  const ticks = usableOdds
    .map((entry) => {
      const odds = resolveMarketOdds(entry.data, { market_focus: marketFocus });
      if (odds === null) return null;

      const entryTime = new Date(entry.fetched_at).getTime();
      const nearbyScores = scoresEntries
        .filter((s) => Array.isArray(s.data))
        .reduce((closest, s) => {
          const t = new Date(s.fetched_at).getTime();
          if (!closest || Math.abs(t - entryTime) < Math.abs(new Date(closest.fetched_at).getTime() - entryTime)) {
            return s;
          }
          return closest;
        }, null);

      const { score, minute, event, matchEnded } = nearbyScores
        ? extractLatestScoreState(nearbyScores.data, 0)
        : { score: { home: 0, away: 0 }, minute: 0, event: null, matchEnded: false };

      return { odds, score, minute, event, matchEnded, timestamp: entry.fetched_at };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  return { ticks, totalOddsPolls: oddsEntries.length, emptyPolls: oddsEntries.length - usableOdds.length };
}

function loadFromFraEspFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, 'utf-8');
  const oddsMatch = text.match(/--- ODDS ---\n([\s\S]*?)\n\n--- SCORES ---/);
  const scoresMatch = text.match(/--- SCORES ---\n([\s\S]*?)\n\n--- VALIDATION PROOFS ---/);

  let oddsArray = [];
  let scoresArray = [];
  try { if (oddsMatch) oddsArray = JSON.parse(oddsMatch[1]); } catch {}
  try { if (scoresMatch) scoresArray = JSON.parse(scoresMatch[1]); } catch {}

  if (!Array.isArray(oddsArray) || oddsArray.length === 0) {
    return { ticks: [], totalOddsPolls: 1, emptyPolls: 1 };
  }

  const marketFocus = argVal('market-focus', '1x2');
  const odds = resolveMarketOdds(oddsArray, { market_focus: marketFocus });
  if (odds === null) return { ticks: [], totalOddsPolls: 1, emptyPolls: 1 };

  const { score, minute, event, matchEnded } = extractLatestScoreState(scoresArray, 0);
  return {
    ticks: [{ odds, score, minute, event, matchEnded, timestamp: new Date().toISOString() }],
    totalOddsPolls: 1, emptyPolls: 0,
  };
}

let loaded = null;
let source = null;
if (FIXTURE_ID) {
  loaded = loadFromJsonlLogs(FIXTURE_ID);
  source = `logs/txline-odds-*.jsonl (fixture ${FIXTURE_ID})`;
}
if (!loaded || loaded.ticks.length === 0) {
  const fallback = loadFromFraEspFile(FRA_ESP_FILE);
  if (fallback) { loaded = fallback; source = FRA_ESP_FILE; }
}

if (!loaded || loaded.ticks.length < 2) {
  console.log('='.repeat(78));
  console.log('Not enough logged data to run a backtest.');
  console.log('='.repeat(78));
  console.log(`Source checked: ${source || '(none found)'}`);
  console.log(`Odds polls found: ${loaded?.totalOddsPolls ?? 0} (${loaded?.emptyPolls ?? 0} were empty '[]')`);
  console.log(`Usable ticks: ${loaded?.ticks.length ?? 0} (need >= 2 for evaluateSignal to have any history)`);
  console.log('\nWhat to do:');
  console.log('  1. Confirm the match has an OPEN market right now -- odds/snapshot');
  console.log('     legitimately returns [] before kickoff and after full time.');
  console.log('  2. Run the logger WHILE the match is live, for several minutes:');
  console.log(`       node scripts/logTxlineData.js --match-id ${FIXTURE_ID || '<fixtureId>'} --poll 15`);
  console.log('     Let that run for a few minutes during play, then re-run this script.');
  process.exit(1);
}

const { ticks } = loaded;
console.log('='.repeat(78));
console.log(`Loaded ${ticks.length} real ticks from ${source}`);
console.log(`Time span: ${ticks[0].timestamp} -> ${ticks[ticks.length - 1].timestamp}`);
console.log('='.repeat(78));

function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function generateAggressiveConfig() {
  const decisionStyle = 'volatility_breakout';
  const sizing = randomChoice(['confidence_weighted', 'percent_of_budget', 'fixed']);
  const exit = randomChoice(['signal_reversal', 'stop-loss', 'time_based']);
  return {
    market_focus: argVal('market-focus', '1x2'), decision_style: decisionStyle,
    confirmation_tolerance: 'aggressive', score_state_mode: 'momentum_only', side_bias: 'none',
    risk_profile: 'aggressive', position_sizing: sizing, exit_rule: exit, aggression: 'instant',
    direction_bias: 'bidirectional', phase_weighting: 'full_match', reentry_rule: 'immediate_reentry',
    max_reentries: null, reaction_latency_ms: 0, wildcard_trait: 'none',
    max_exposure_pct: randomInt(25, 50), max_drawdown_stop_pct: randomInt(25, 50),
    percentage_stake: randomInt(12, 25), fixed_stake: (Math.random() * 0.09 + 0.01).toFixed(4),
    stop_loss: randomInt(3, 10), take_profit: randomInt(10, 25),
  };
}

let agents;
if (CONFIG_PATH) {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  agents = [makeAgent(config.name || 'agent-custom', config, config.budget_cap ?? BUDGET)];
} else {
  agents = Array.from({ length: NUM_AGENTS }, (_, i) => {
    const config = generateAggressiveConfig();
    return makeAgent(`agent-${i + 1}:${config.decision_style}`, config, BUDGET);
  });
}

agents.forEach((a) => {
  console.log(`\n${a.name}`);
  console.log('  ' + JSON.stringify(a.config));
});
console.log('\nReplaying...\n');

function markToMarket(entryOdds, currentOdds, side, stake) {
  const change = side === 'buy' ? (entryOdds - currentOdds) / entryOdds : (currentOdds - entryOdds) / entryOdds;
  return stake * change;
}
function makeAgent(name, config, budget) {
  return {
    name, config, budget, balance: budget, realizedPnl: 0, unrealizedPnl: 0,
    tradeCount: 0, trades: [], position: null, lastTradeAt: 0,
    signalStreak: { action: null, count: 0 }, peakBalance: budget,
    maxDrawdownPct: 0, halted: false, maxReentriesWarned: false,
  };
}
function log(agent, ...msg) { if (!QUIET) console.log(`[${agent.name}]`, ...msg); }
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
function passesAggressionFilter(agent, decision, now) {
  const mode = agent.config.aggression || 'instant';
  if (mode === 'cooldown') {
    const cooldownMs = (agent.config.cooldown_minutes ?? 2) * 60 * 1000;
    if (now - agent.lastTradeAt < cooldownMs) return { pass: false, reason: 'cooldown_active' };
    return { pass: true };
  }
  if (mode === 'confirmation') {
    if (agent.signalStreak.action === decision.action) agent.signalStreak.count += 1;
    else agent.signalStreak = { action: decision.action, count: 1 };
    if (agent.signalStreak.count < 2) return { pass: false, reason: `awaiting_confirmation:${agent.signalStreak.count}/2` };
    return { pass: true };
  }
  return { pass: true };
}
function applyExposureCap(agent, stake) {
  if (agent.config.max_exposure_pct == null) return stake;
  return Math.min(stake, agent.balance * (agent.config.max_exposure_pct / 100));
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
  log(agent, `CLOSE ${agent.position.side} stake=${agent.position.stake.toFixed(2)} pnl=${realized >= 0 ? '+' : ''}${realized.toFixed(2)} -> balance=${agent.balance.toFixed(2)} reason=${reason}`);
  recordTrade(agent, `close_${agent.position.side}`, snapshot.odds, agent.position.stake, reason, snapshot.minute, realized);
  agent.unrealizedPnl = 0;
  agent.position = null;
}
function tickAgent(agent, history, snapshot, now) {
  if (agent.halted) return;
  if (checkMaxDrawdownStop(agent)) return;
  if (agent.position) {
    agent.unrealizedPnl = markToMarket(agent.position.odds, snapshot.odds, agent.position.side, agent.position.stake);
    if (agent.config.exit_rule === 'stop-loss' || agent.config.exit_rule === 'stop_loss_take_profit') {
      const check = checkStopLossTakeProfit(agent, snapshot.odds);
      if (check.exit) closePosition(agent, snapshot, check.reason);
    }
  }
  const decision = evaluateSignal(agent.config, history);
  if (decision.action === 'hold') { agent.signalStreak = { action: null, count: 0 }; return; }
  if (agent.position && agent.config.exit_rule === 'signal_reversal' && decision.action !== agent.position.side) {
    closePosition(agent, snapshot, decision.reason);
  }
  if (!agent.position) {
    if (agent.config.max_reentries != null && agent.tradeCount >= agent.config.max_reentries) return;
    const gate = passesAggressionFilter(agent, decision, now);
    if (!gate.pass) return;
    let stake = computeStake(agent.config, agent.balance, decision.confidence);
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

const history = [];
for (const snapshot of ticks) {
  history.push(snapshot);
  if (!QUIET) {
    console.log(`\n[${snapshot.minute}'] odds=${snapshot.odds.toFixed(3)} score=${snapshot.score.home}-${snapshot.score.away} event=${snapshot.event || '-'}`);
  }
  const now = new Date(snapshot.timestamp).getTime();
  for (const agent of agents) tickAgent(agent, history, snapshot, now);
}

const finalSnapshot = ticks[ticks.length - 1];
for (const agent of agents) {
  if (agent.position) closePosition(agent, finalSnapshot, 'replay_ended');
}

console.log('\n' + '='.repeat(78));
console.log('FINAL RESULTS (replayed against REAL logged TxLINE data)');
console.log('='.repeat(78));

const rows = agents.map((a) => {
  const closed = a.trades.filter((t) => t.pnl !== undefined);
  const wins = closed.filter((t) => t.pnl > 0).length;
  const losses = closed.filter((t) => t.pnl <= 0).length;
  const roiPct = ((a.balance - a.budget) / a.budget) * 100;
  return {
    name: a.name, signal: a.config.decision_style, trades: a.tradeCount, wins, losses,
    winRate: closed.length ? `${((wins / closed.length) * 100).toFixed(0)}%` : 'n/a',
    startBalance: a.budget.toFixed(2), finalBalance: a.balance.toFixed(2),
    pnl: a.realizedPnl.toFixed(2), roi: `${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(2)}%`,
    maxDrawdown: `${a.maxDrawdownPct.toFixed(1)}%`, halted: a.halted ? 'HALTED' : '',
  };
});
rows.sort((a, b) => parseFloat(b.roi) - parseFloat(a.roi));
console.table(rows);

const winner = rows[0];
if (winner) console.log(`\n🏆 Best performer: ${winner.name} (${winner.roi}, ${winner.trades} trades, ${winner.winRate} win rate)`);
console.log('\nNote: REAL logged TxLINE prices, mark-to-market PnL still simulated (no on-chain settlement in this script).');
