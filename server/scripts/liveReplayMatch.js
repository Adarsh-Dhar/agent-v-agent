#!/usr/bin/env node
/**
 * scripts/liveReplayMatch.js
 *
 * Plays back a SAVED match log in real time, compressed 60x: match minute N
 * fires at simulation second N. Reuses the exact same agent engine
 * (evaluateSignal/computeStake/markToMarket) as simulateAgentTrading.js and
 * replayLoggedFeed.js -- this script only changes WHEN each tick fires, not
 * how agents decide or how PnL is computed.
 *
 * Unlike replayLoggedFeed.js (which processes all ticks instantly), this
 * script uses a real setInterval so you can watch the match "happen" live,
 * same as npm run agent:simulate does against the mock feed -- except this
 * one is driven entirely by REAL logged TxLINE data.
 *
 * IMPORTANT FIX baked in here: the SCORES array from
 * /api/scores/snapshot/{fixtureId} is NOT chronological -- it's sorted
 * alphabetically by Action name (confirmed on two independent fixtures).
 * This script re-sorts everything by the real `Ts` field before building
 * the minute-by-minute schedule, or the playback would show halftime before
 * kickoff.
 *
 * SECOND FIX baked in here: 'clock_adjustment' events report
 * { Running: false, Seconds: 0 } which would otherwise wrongly reset the
 * carried-forward minute back to 0 right before events like game_finalised
 * that have no Clock field at all. Only Clock readings where Running===true
 * are trusted.
 *
 * Two modes, auto-detected:
 *   - TRADING mode: an odds series was found (via --odds-file or a matching
 *     logs/txline-odds-*.jsonl) -> agents actually open/close positions and
 *     accrue real mark-to-market PnL, exactly like the live pipeline would.
 *   - TIMELINE mode: no odds series found -> there is nothing for
 *     markToMarket to compute against, so this just plays back the real
 *     event sequence (goals, cards, halftime, full time) at the same
 *     minute=second pacing, with a clear banner explaining why no trades
 *     can happen. Still useful on its own as a "watch the match" preview,
 *     and the moment you add a matching odds log it upgrades to TRADING
 *     mode automatically.
 *
 * Usage:
 *   node scripts/liveReplayMatch.js --scores-file ./fra-esp-logs.txt
 *   node scripts/liveReplayMatch.js --scores-file ./fra-esp-logs.txt --odds-file ./odds-fra-esp.jsonl
 *   node scripts/liveReplayMatch.js --fixture 18237038          # pulls from logs/ dir
 *   node scripts/liveReplayMatch.js --scores-file ./fra-esp-logs.txt --fast   # no real-time pauses, for testing
 *   node scripts/liveReplayMatch.js --scores-file ./fra-esp-logs.txt --agents 3
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { evaluateSignal, computeStake } from '../src/lib/strategyEngine.js';
import { resolveMarketOdds, extractLatestScoreState } from '../src/lib/txline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : def;
}
const SCORES_FILE = argVal('scores-file', null);
const ODDS_FILE = argVal('odds-file', null);
let FIXTURE_ID = argVal('fixture', null);

// Auto-detect latest fixture if none specified and logs directory exists
if (!FIXTURE_ID && !SCORES_FILE && fs.existsSync(LOG_DIR)) {
  const oddsFiles = fs.readdirSync(LOG_DIR)
    .filter((f) => f.startsWith('txline-odds-') && f.endsWith('.jsonl'))
    .sort()
    .reverse();
  if (oddsFiles.length > 0) {
    // Extract date from filename like "txline-odds-2026-07-14.jsonl"
    const dateMatch = oddsFiles[0].match(/txline-odds-(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      FIXTURE_ID = dateMatch[1]; // Use date as fixture ID for auto-detection
      console.log(`Auto-detected latest logs from ${dateMatch[1]}`);
    }
  }
}

// Fall back to old text file if still no fixture/scores file specified
if (!SCORES_FILE && !FIXTURE_ID) {
  SCORES_FILE = path.join(ROOT, 'fra-esp-logs.txt');
}
const NUM_AGENTS = args.includes('--config') ? 1 : parseInt(argVal('agents', '3'), 10);
const BUDGET = parseFloat(argVal('budget', '1000'));
const CONFIG_PATH = argVal('config', null);
const FAST = args.includes('--fast'); // skip real-time pauses (for testing/CI)
const QUIET = args.includes('--quiet');
const MARKET_FOCUS = argVal('market-focus', '1x2');

// ---------------------------------------------------------------------------
// Loading + TRUE chronological reconstruction of the scores/events feed
// ---------------------------------------------------------------------------
function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function loadScoresArray() {
  // Prefer JSONL logs (logTxlineData.js) if --fixture given.
  if (FIXTURE_ID && fs.existsSync(LOG_DIR)) {
    const files = fs.readdirSync(LOG_DIR)
      .filter((f) => f.startsWith('txline-scores-') && f.endsWith('.jsonl'))
      .sort()
      .map((f) => path.join(LOG_DIR, f));
    if (files.length) {
      const entries = files.flatMap(loadJsonl).filter((e) => Array.isArray(e.data) && e.data.length);
      if (entries.length) {
        // Merge every poll's array together and dedup by event Id -- the
        // same event can appear in multiple polls while it's still "latest".
        const merged = new Map();
        for (const entry of entries) {
          for (const ev of entry.data) {
            const key = `${ev.Action}-${ev.Id}`;
            const existing = merged.get(key);
            if (!existing || (ev.Ts ?? 0) > (existing.Ts ?? 0)) merged.set(key, ev);
          }
        }
        return [...merged.values()];
      }
    }
  }
  // Fall back to a single fetchFraEsp.js-style file.
  if (fs.existsSync(SCORES_FILE)) {
    const text = fs.readFileSync(SCORES_FILE, 'utf-8');
    const scoresMatch = text.match(/--- SCORES ---\n([\s\S]*?)\n\n--- VALIDATION PROOFS ---/);
    try {
      if (scoresMatch) return JSON.parse(scoresMatch[1]);
    } catch { /* fall through */ }
  }
  return [];
}

function loadOddsArray() {
  if (ODDS_FILE) return loadJsonl(ODDS_FILE);
  if (FIXTURE_ID && fs.existsSync(LOG_DIR)) {
    const files = fs.readdirSync(LOG_DIR)
      .filter((f) => f.startsWith('txline-odds-') && f.endsWith('.jsonl'))
      .sort()
      .map((f) => path.join(LOG_DIR, f));
    return files.flatMap(loadJsonl);
  }
  return [];
}

function loadProofsArray() {
  if (FIXTURE_ID && fs.existsSync(LOG_DIR)) {
    const files = fs.readdirSync(LOG_DIR)
      .filter((f) => f.startsWith('txline-proofs-') && f.endsWith('.jsonl'))
      .sort()
      .map((f) => path.join(LOG_DIR, f));
    return files.flatMap(loadJsonl);
  }
  return [];
}

const rawScores = loadScoresArray();
if (rawScores.length === 0) {
  console.error(`No scores data found (checked --fixture=${FIXTURE_ID}, --scores-file=${SCORES_FILE}).`);
  process.exit(1);
}

// THE FIX: real chronological order, not alphabetical-by-Action order.
const chronological = [...rawScores].sort((a, b) => (a.Ts ?? 0) - (b.Ts ?? 0));

// Carry-forward minute derivation: most events have Clock.Seconds; a few
// (game_finalised, jersey, venue, weather, connected/disconnected) don't --
// those hold whatever minute was last known rather than resetting to 0.
let carryMinute = 0;
const timeline = chronological.map((ev) => {
  // Only trust an ACTIVE clock reading. Paused/adjustment markers (e.g.
  // clock_adjustment) report { Running: false, Seconds: 0 } which would
  // otherwise wrongly reset the carried-forward minute back to 0 right
  // before events like game_finalised that have no Clock field at all.
  if (ev.Clock?.Running === true && ev.Clock?.Seconds != null) {
    carryMinute = Math.floor(ev.Clock.Seconds / 60);
  }
  const home = ev.Score?.Participant1?.Total?.Goals;
  const away = ev.Score?.Participant2?.Total?.Goals;
  return {
    ts: ev.Ts,
    minute: carryMinute,
    action: ev.Action,
    score: home != null || away != null ? { home: home ?? 0, away: away ?? 0 } : null,
    matchEnded: ev.Action === 'game_finalised' || ev.StatusId === 100,
  };
});

// Only keep events that actually carry meaningful info for a tick (a real
// score OR a directional event) -- pure telemetry noise (connected,
// coverage_update, jersey, pitch, weather, venue, players_warming_up) is
// dropped from the per-minute schedule, though it stays in `timeline` above
// in case you want the full log.
const SCORE_STATE_EVENTS = new Set(['goal', 'red_card', 'yellow_card', 'penalty_outcome', 'var_end', 'halftime_finalised', 'game_finalised']);

// Track running score to classify a bare 'goal' event as goal_home/goal_away
// by comparing against the previous known score.
//
// NOTE: this tracker is scoped ONLY to this build-time loop. It must NOT be
// reused later during live playback -- by the time playback starts, a
// module-scoped "running score" variable would already hold the FINAL score
// of the whole match (since this loop walks every event up front), which
// would make every minute display the final score instead of the score at
// that point in time. See scoreByMinute below for the value playMinute()
// actually uses.
let runningScoreForEvents = { home: 0, away: 0 };
const scheduleEvents = [];
for (const t of timeline) {
  if (t.score) {
    if (t.action === 'goal' && (t.score.home > runningScoreForEvents.home || t.score.away > runningScoreForEvents.away)) {
      scheduleEvents.push({ minute: t.minute, event: t.score.home > runningScoreForEvents.home ? 'goal_home' : 'goal_away', score: t.score });
    }
    runningScoreForEvents = t.score;
  }
  if (t.action === 'red_card') {
    scheduleEvents.push({ minute: t.minute, event: 'red_card_home', score: runningScoreForEvents });
  }
  if (t.matchEnded) {
    scheduleEvents.push({ minute: t.minute, event: 'game_finalised', score: t.score || runningScoreForEvents, matchEnded: true });
  }
}

const maxMinute = Math.max(...timeline.map((t) => t.minute), 1);

// Proper minute-indexed score lookup, correctly carried FORWARD IN TIME
// (not "whatever the score ended up being by the time the build loop
// finished"). This is what playMinute() should read from.
const scoreByMinute = new Array(maxMinute + 1).fill(null);
{
  let running = { home: 0, away: 0 };
  for (const t of timeline) {
    if (t.score) running = t.score;
    if (t.minute >= 0 && t.minute <= maxMinute) scoreByMinute[t.minute] = running;
  }
  let lastKnown = { home: 0, away: 0 };
  for (let m = 0; m <= maxMinute; m++) {
    if (scoreByMinute[m] === null) scoreByMinute[m] = lastKnown;
    else lastKnown = scoreByMinute[m];
  }
}

// ---------------------------------------------------------------------------
// Odds series (optional) -- correlate each odds poll's real fetched_at time
// to the nearest scores Ts to derive which match-minute it belongs to, then
// carry-forward fill every minute 0..maxMinute so there's always a price.
// ---------------------------------------------------------------------------
const rawOdds = loadOddsArray().filter((e) => Array.isArray(e.data) && e.data.length > 0);
let oddsBucketed = null;

if (rawOdds.length > 0) {
  const oddsWithMinute = rawOdds.map((entry) => {
    const t = new Date(entry.fetched_at).getTime();
    const nearest = timeline.reduce((closest, ev) =>
      !closest || Math.abs((ev.ts ?? 0) - t) < Math.abs((closest.ts ?? 0) - t) ? ev : closest, null);
    const minute = nearest?.minute ?? 0;
    const price = resolveMarketOdds(entry.data, { market_focus: MARKET_FOCUS });
    return price !== null ? { minute, price } : null;
  }).filter(Boolean);

  if (oddsWithMinute.length > 0) {
    oddsBucketed = new Array(maxMinute + 1).fill(null);
    for (const { minute, price } of oddsWithMinute) {
      if (minute <= maxMinute) oddsBucketed[minute] = price;
    }
    let lastKnown = oddsWithMinute[0].price;
    for (let m = 0; m <= maxMinute; m++) {
      if (oddsBucketed[m] === null) oddsBucketed[m] = lastKnown;
      else lastKnown = oddsBucketed[m];
    }
  }
}

// ---------------------------------------------------------------------------
// Proofs series -- correlate each proof poll's real fetched_at time
// to the nearest scores Ts to derive which match-minute it belongs to.
// ---------------------------------------------------------------------------
const rawProofs = loadProofsArray().filter((e) => e.data && typeof e.data === 'object');
let proofsBucketed = null;

if (rawProofs.length > 0) {
  const proofsWithMinute = rawProofs.map((entry) => {
    const t = new Date(entry.fetched_at).getTime();
    const nearest = timeline.reduce((closest, ev) =>
      !closest || Math.abs((ev.ts ?? 0) - t) < Math.abs((closest.ts ?? 0) - t) ? ev : closest, null);
    const minute = nearest?.minute ?? 0;
    const proofData = entry.data;
    return proofData ? { minute, proofData } : null;
  }).filter(Boolean);

  if (proofsWithMinute.length > 0) {
    proofsBucketed = new Array(maxMinute + 1).fill(null);
    for (const { minute, proofData } of proofsWithMinute) {
      if (minute <= maxMinute) proofsBucketed[minute] = proofData;
    }
    let lastKnown = proofsWithMinute[0].proofData;
    for (let m = 0; m <= maxMinute; m++) {
      if (proofsBucketed[m] === null) proofsBucketed[m] = lastKnown;
      else lastKnown = proofsBucketed[m];
    }
  }
}

const TRADING_MODE = oddsBucketed !== null;

console.log('='.repeat(78));
console.log(`Loaded ${chronological.length} real events, reconstructed true chronological order.`);
console.log(`Match span: minute 0 -> ${maxMinute}. Mode: ${TRADING_MODE ? 'TRADING (odds series found)' : 'TIMELINE (no odds series -- event playback only)'}`);
if (proofsBucketed) {
  console.log(`Proofs series: ${rawProofs.length} proof entries loaded`);
}
if (maxMinute < 90) {
  console.log(`⚠️  Note: Logged data only covers minutes 0-${maxMinute}. For full 90-minute replay, run logger during entire match.`);
}
console.log('='.repeat(78));
if (!TRADING_MODE) {
  console.log('\nNo odds data available for this match, so there is no price series for');
  console.log('markToMarket to compute PnL against. This will play back the real event');
  console.log('timeline at the same minute=second pacing, but agents cannot open/close');
  console.log('positions. Add a matching --odds-file (or logs/txline-odds-*.jsonl for');
  console.log('this fixture) to upgrade this to full trading mode.\n');
}

// ---------------------------------------------------------------------------
// Agents (same generator as replayLoggedFeed.js)
// ---------------------------------------------------------------------------
function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function generateAggressiveConfig() {
  const decisionStyle = 'volatility_breakout';
  const sizing = randomChoice(['confidence_weighted', 'percent_of_budget', 'fixed']);
  const exit = randomChoice(['signal_reversal', 'stop-loss', 'time_based']);
  return {
    market_focus: MARKET_FOCUS, decision_style: decisionStyle, confirmation_tolerance: 'aggressive',
    score_state_mode: 'momentum_only', side_bias: 'none', risk_profile: 'aggressive',
    position_sizing: sizing, exit_rule: exit, aggression: 'instant', direction_bias: 'bidirectional',
    phase_weighting: 'full_match', reentry_rule: 'immediate_reentry', max_reentries: null,
    reaction_latency_ms: 0, wildcard_trait: 'none',
    max_exposure_pct: randomInt(25, 50), max_drawdown_stop_pct: randomInt(25, 50),
    percentage_stake: randomInt(12, 25), fixed_stake: randomInt(80, 220),
    stop_loss: randomInt(3, 10), take_profit: randomInt(10, 25),
  };
}

const HALFTIME_MINUTE = 45;
const FULLTIME_MINUTE = 90;

function markToMarket(entryOdds, currentOdds, side, stake) {
  const change = side === 'buy' ? (entryOdds - currentOdds) / entryOdds : (currentOdds - entryOdds) / entryOdds;
  return stake * change;
}
function makeAgent(name, config, budget) {
  return {
    name, config, budget, balance: budget, realizedPnl: 0, unrealizedPnl: 0,
    tradeCount: 0, trades: [], position: null, lastTradeAt: 0,
    signalStreak: { action: null, count: 0 }, peakBalance: budget,
    maxDrawdownPct: 0, halted: false,
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
function checkTimeBasedExit(agent, currentMinute) {
  const crossedHalftime = agent.position.entryMinute < HALFTIME_MINUTE && currentMinute >= HALFTIME_MINUTE;
  const crossedFulltime = currentMinute >= FULLTIME_MINUTE;
  if (crossedHalftime) return { exit: true, reason: `time_based:halftime_min_${currentMinute}` };
  if (crossedFulltime) return { exit: true, reason: `time_based:fulltime_min_${currentMinute}` };
  return { exit: false };
}
function applyExposureCap(agent, stake) {
  if (agent.config.max_exposure_pct == null) return stake;
  return Math.min(stake, agent.balance * (agent.config.max_exposure_pct / 100));
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
  if (agent.halted || !TRADING_MODE) return;
  if (agent.position) {
    agent.unrealizedPnl = markToMarket(agent.position.odds, snapshot.odds, agent.position.side, agent.position.stake);
    const exitRule = agent.config.exit_rule;
    if (exitRule === 'stop-loss' || exitRule === 'stop_loss_take_profit') {
      const check = checkStopLossTakeProfit(agent, snapshot.odds);
      if (check.exit) closePosition(agent, snapshot, check.reason);
    } else if (exitRule === 'time_based') {
      const check = checkTimeBasedExit(agent, snapshot.minute);
      if (check.exit) closePosition(agent, snapshot, check.reason);
    }
  }
  const decision = evaluateSignal(agent.config, history);
  if (decision.action === 'hold') return;
  if (agent.position && agent.config.exit_rule === 'signal_reversal' && decision.action !== agent.position.side) {
    closePosition(agent, snapshot, decision.reason);
  }
  if (!agent.position) {
    let stake = computeStake(agent.config, agent.balance, decision.confidence);
    stake = applyExposureCap(agent, stake);
    if (stake <= 0 || stake > agent.balance) return;
    agent.position = { side: decision.action, odds: snapshot.odds, stake, entryMinute: snapshot.minute };
    agent.tradeCount += 1;
    log(agent, `OPEN ${decision.action} stake=${stake.toFixed(2)} @odds=${snapshot.odds} reason=${decision.reason}`);
    recordTrade(agent, decision.action, snapshot.odds, stake, decision.reason, snapshot.minute, undefined);
  }
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
agents.forEach((a) => console.log(`\n${a.name}\n  ${JSON.stringify(a.config)}`));
console.log(`\nReplaying live: minute N fires at second N${FAST ? ' (--fast: no real-time pauses)' : ''}...\n`);

// ---------------------------------------------------------------------------
// The actual "minute = second" playback loop
// ---------------------------------------------------------------------------
const history = [];
let minute = 0;

function playMinute() {
  const eventsThisMinute = scheduleEvents.filter((e) => e.minute === minute);
  const significant = eventsThisMinute.find((e) => e.event.startsWith('goal') || e.event.startsWith('red_card')) || eventsThisMinute[0];
  const score = scoreByMinute[minute] || significant?.score || { home: 0, away: 0 };

  const snapshot = {
    minute,
    score,
    event: significant?.event ?? null,
    odds: TRADING_MODE ? oddsBucketed[minute] : null,
    proofs: proofsBucketed ? proofsBucketed[minute] : null,
    matchEnded: eventsThisMinute.some((e) => e.matchEnded),
  };
  history.push(snapshot);

  if (!QUIET) {
    const proofInfo = snapshot.proofs ? `proofs=✓ ` : '';
    console.log(`\n[${snapshot.minute}'] ${TRADING_MODE ? `odds=${snapshot.odds.toFixed(3)} ` : ''}${proofInfo}score=${snapshot.score.home}-${snapshot.score.away} event=${snapshot.event || '-'}`);
  }

  const now = Date.now();
  for (const agent of agents) tickAgent(agent, history, snapshot, now);

  if (snapshot.matchEnded || minute >= maxMinute) {
    finish(snapshot);
    return;
  }
  minute += 1;
  if (FAST) playMinute();
  else setTimeout(playMinute, 1000); // 1 real second = 1 match minute
}

function finish(finalSnapshot) {
  if (TRADING_MODE) {
    for (const agent of agents) if (agent.position) closePosition(agent, finalSnapshot, 'match_ended');
  }
  console.log('\n' + '='.repeat(78));
  console.log(TRADING_MODE ? 'FINAL RESULTS (live-paced replay of a real match)' : 'TIMELINE PLAYBACK COMPLETE (no trading -- no odds series)');
  console.log('='.repeat(78));

  if (TRADING_MODE) {
    const rows = agents.map((a) => {
      const closed = a.trades.filter((t) => t.pnl !== undefined);
      const wins = closed.filter((t) => t.pnl > 0).length;
      const roiPct = ((a.balance - a.budget) / a.budget) * 100;
      return {
        name: a.name, signal: a.config.decision_style, trades: a.tradeCount, wins,
        winRate: closed.length ? `${((wins / closed.length) * 100).toFixed(0)}%` : 'n/a',
        finalBalance: a.balance.toFixed(2), pnl: a.realizedPnl.toFixed(2),
        roi: `${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(2)}%`,
      };
    });
    rows.sort((a, b) => parseFloat(b.roi) - parseFloat(a.roi));
    console.table(rows);
    if (rows[0]) console.log(`\n🏆 Best performer: ${rows[0].name} (${rows[0].roi}, ${rows[0].trades} trades)`);
  }
  process.exit(0);
}

playMinute();