#!/usr/bin/env node
/**
 * scripts/replayMatch.js
 *
 * Reads raw TxLINE JSONL logs from server/logs/ and replays a match in
 * real-time to the terminal. Merges odds + scores chronologically so
 * minutes, goals, and events are accurate.
 *
 * Usage:
 *   node scripts/replayMatch.js --home Argentina --away England
 *   node scripts/replayMatch.js --home Argentina --away England --speed 10
 *   node scripts/replayMatch.js --home Argentina --away England --speed 0
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveMarketOdds, extractLatestScoreState } from '../src/lib/txline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, '..', 'logs');

function argVal(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
}

const FIXTURE_ID = Number(argVal('fixture', '18241006'));
const SPEED = Number(argVal('speed', '1'));
const HOME_TEAM = argVal('home', 'Home');
const AWAY_TEAM = argVal('away', 'Away');

function loadJsonl(kind) {
  if (!fs.existsSync(LOGS_DIR)) return [];
  return fs.readdirSync(LOGS_DIR)
    .filter((f) => f.startsWith(`txline-${kind}-`) && f.endsWith('.jsonl'))
    .sort()
    .flatMap((f) =>
      fs.readFileSync(path.join(LOGS_DIR, f), 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean)
    );
}

console.log(`\n  Match Replay: ${HOME_TEAM} vs ${AWAY_TEAM}`);
console.log(`  Fixture ID: ${FIXTURE_ID}`);
console.log(`  Speed: ${SPEED === 0 ? 'instant' : SPEED + 'x'}\n`);

const allOdds = loadJsonl('odds');
const allScores = loadJsonl('scores');

const oddsEntries = allOdds
  .map((e) => ({ ...e, data: (e.data || []).filter((m) => m.FixtureId === FIXTURE_ID) }))
  .filter((e) => e.data.length > 0);

const scoresEntries = allScores
  .map((e) => ({
    ...e,
    data: (Array.isArray(e.data) ? e.data : [e.data]).filter((s) => s.FixtureId === FIXTURE_ID),
  }))
  .filter((e) => e.data.length > 0);

if (oddsEntries.length === 0) {
  console.error(`No odds data found for fixture ${FIXTURE_ID} in ${LOGS_DIR}`);
  process.exit(1);
}

console.log(`  Loaded ${oddsEntries.length} odds polls, ${scoresEntries.length} score updates`);
const logStart = new Date(oddsEntries[0].fetched_at);
const logEnd = new Date(oddsEntries[oddsEntries.length - 1].fetched_at);
console.log(`  Duration: ${Math.round((logEnd - logStart) / 1000)}s real time\n`);

// Pre-build score timeline: process ALL score entries chronologically,
// maintaining running minute/score state. This avoids the nearest-neighbor
// bug where different score entries jump around.
const scoreTimeline = [];
let runningMinute = 0;
let runningScore = { home: 0, away: 0 };
let runningEvent = null;

for (const entry of scoresEntries) {
  const result = extractLatestScoreState(entry.data, runningMinute);
  runningMinute = result.minute;
  runningScore = result.score;
  runningEvent = result.event;
  scoreTimeline.push({
    time: new Date(entry.fetched_at).getTime(),
    minute: result.minute,
    score: { ...result.score },
    event: result.event,
    matchEnded: result.matchEnded,
  });
}

// Merge into a single timeline: for each odds entry, find the latest
// score state at that point in time using the pre-built scoreTimeline.
const timeline = [];
let scoreIdx = 0;

for (const oddsEntry of oddsEntries) {
  const oddsTime = new Date(oddsEntry.fetched_at).getTime();

  // Advance scoreIdx to the latest score entry at or before this time
  while (scoreIdx < scoreTimeline.length - 1 && scoreTimeline[scoreIdx + 1].time <= oddsTime) {
    scoreIdx++;
  }

  const scoreState = scoreTimeline[scoreIdx] || scoreTimeline[0];
  const odds = resolveMarketOdds(oddsEntry.data, { market_focus: '1x2' });

  timeline.push({
    time: oddsTime,
    odds,
    minute: scoreState.minute,
    score: { ...scoreState.score },
    event: scoreState.event,
    matchEnded: scoreState.matchEnded,
  });
}

console.log(`${'─'.repeat(70)}`);

let lastHomeGoals = 0;
let lastAwayGoals = 0;
let lastOdds = null;
let lastMinute = -1;

function formatOdds(odds) {
  if (odds === null || odds === undefined) return '  N/A ';
  return odds.toFixed(3).padStart(6);
}

function formatScore(score) {
  return `${score.home}-${score.away}`;
}

function formatPeriod(minute) {
  if (minute >= 105) return 'PENS';
  if (minute >= 90) return 'ET';
  if (minute >= 45) return '2H';
  return '1H';
}

function printTick(tick, index) {
  const events = [];
  if (tick.score.home > lastHomeGoals) {
    events.push(`⚽ GOAL ${HOME_TEAM}`);
    lastHomeGoals = tick.score.home;
  }
  if (tick.score.away > lastAwayGoals) {
    events.push(`⚽ GOAL ${AWAY_TEAM}`);
    lastAwayGoals = tick.score.away;
  }
  if (tick.event && !events.length) {
    events.push(tick.event);
  }

  const oddsChanged = lastOdds !== null && tick.odds !== null && Math.abs(tick.odds - lastOdds) > 0.05;
  const eventStr = events.length ? events.join(', ') : '-';
  const period = formatPeriod(tick.minute);
  const minuteStr = `${String(tick.minute).padStart(2)}'`;
  const oddsStr = formatOdds(tick.odds);
  const scoreStr = formatScore(tick.score);
  const delta = tick.odds !== null && lastOdds !== null ? (tick.odds - lastOdds) : 0;
  const deltaStr = delta !== 0 ? ` (${delta > 0 ? '+' : ''}${delta.toFixed(3)})` : '';

  const tickNum = String(index + 1).padStart(3);
  const line = `${tickNum} [${period}] ${minuteStr}  odds=${oddsStr}  score=${scoreStr}  ${eventStr}${deltaStr}`;

  if (events.length && events[0].startsWith('⚽')) {
    console.log(`\x1b[1;33m${line}\x1b[0m`);
  } else if (oddsChanged) {
    console.log(`\x1b[36m${line}\x1b[0m`);
  } else {
    console.log(line);
  }

  lastOdds = tick.odds;
}

async function run() {
  let ended = false;
  for (let i = 0; i < timeline.length && !ended; i++) {
    const tick = timeline[i];

    if (SPEED > 0 && i > 0) {
      const delay = Math.round((timeline[i].time - timeline[i - 1].time) / SPEED);
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, Math.min(delay, 2000)));
      }
    }

    printTick(tick, i);
    if (tick.matchEnded) ended = true;
  }

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  Match ended. ${HOME_TEAM} ${lastHomeGoals} - ${lastAwayGoals} ${AWAY_TEAM}`);
  console.log(`  Processed ${timeline.length} ticks\n`);
}

run();
