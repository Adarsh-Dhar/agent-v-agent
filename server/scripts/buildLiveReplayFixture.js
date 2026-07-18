#!/usr/bin/env node
/**
 * scripts/buildLiveReplayFixture.js
 *
 * Converts REAL logged TxLINE data (captured via logTxlineData.js while a
 * match is/was actually live) into a replay fixture JSON in the exact
 * schema server/src/lib/replays/<fixtureId>.json needs -- one entry per
 * match minute, with REAL odds (not synthesized). This is what lets a
 * genuinely-live TxLine match play through the existing replay engine
 * (txlineReplay.js) the same way the hand-built fixtures (e.g. 18241006,
 * Argentina vs Switzerland) already do -- no on-chain wallet/devnet SOL
 * setup required.
 *
 * PREREQUISITE: capture the match's data first, WHILE it's live (or as
 * much of it as you can get):
 *   node scripts/logTxlineData.js --match-id 18257865 --poll 15
 * Let that run for the match, Ctrl+C when done, then run this script.
 * (buildReplayFixture.js already in this repo only reads the scores log
 * and only emits goal/card-change minutes with no odds field at all --
 * this script merges odds + scores logs into one real per-minute odds
 * series, matching how 18241006.json was actually built.)
 *
 * Usage:
 *   node scripts/buildLiveReplayFixture.js --fixture-id 18257865 --home France --away England
 *   node scripts/buildLiveReplayFixture.js --fixture-id 18257865 --home France --away England --market-focus 1x2
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveMarketOdds, extractLatestScoreState } from '../src/lib/txline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');

function argVal(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
}

const FIXTURE_ID = argVal('fixture-id', null);
const HOME = argVal('home', null);
const AWAY = argVal('away', null);
const MARKET_FOCUS = argVal('market-focus', '1x2');

if (!FIXTURE_ID || !HOME || !AWAY) {
  console.error(
    'Usage: node scripts/buildLiveReplayFixture.js --fixture-id <id> --home <team> --away <team> [--market-focus 1x2]'
  );
  process.exit(1);
}

function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function findLogFiles(kind) {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs
    .readdirSync(LOG_DIR)
    .filter((f) => f.startsWith(`txline-${kind}-`) && f.endsWith('.jsonl'))
    .sort()
    .map((f) => path.join(LOG_DIR, f));
}

console.log(`Loading logged data for fixture ${FIXTURE_ID}...`);

const oddsEntries = findLogFiles('odds').flatMap(loadJsonl);
const scoresEntries = findLogFiles('scores').flatMap(loadJsonl);

// logTxlineData.js's log files are per-day, not per-fixture, so if you've
// logged more than one match on the same day, filter down to this one.
const fixtureOdds = oddsEntries
  .map((e) => ({ ...e, data: (e.data || []).filter((m) => m.FixtureId === Number(FIXTURE_ID)) }))
  .filter((e) => e.data.length > 0);

const fixtureScores = scoresEntries
  .map((e) => ({
    ...e,
    data: (Array.isArray(e.data) ? e.data : [e.data]).filter((s) => s.FixtureId === Number(FIXTURE_ID)),
  }))
  .filter((e) => e.data.length > 0);

if (fixtureOdds.length === 0) {
  console.error(`No odds polls found for fixture ${FIXTURE_ID} in ${LOG_DIR}.`);
  console.error(`Run this first, while the match is live:`);
  console.error(`  node scripts/logTxlineData.js --match-id ${FIXTURE_ID} --poll 15`);
  process.exit(1);
}

// Resolve one real odds+score tick per poll.
const ticks = fixtureOdds
  .map((entry) => {
    const odds = resolveMarketOdds(entry.data, { market_focus: MARKET_FOCUS });
    if (odds === null) return null;

    const entryTime = new Date(entry.fetched_at).getTime();
    const nearestScores = fixtureScores.reduce((closest, s) => {
      const t = new Date(s.fetched_at).getTime();
      if (!closest || Math.abs(t - entryTime) < Math.abs(new Date(closest.fetched_at).getTime() - entryTime)) {
        return s;
      }
      return closest;
    }, null);

    const { score, minute, event } = nearestScores
      ? extractLatestScoreState(nearestScores.data, 0)
      : { score: { home: 0, away: 0 }, minute: 0, event: null };

    return { odds, score, minute, event, timestamp: entry.fetched_at };
  })
  .filter(Boolean)
  .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

console.log(`Resolved ${ticks.length} real odds+score ticks.`);

// Bucket into one entry per match minute -- same shape the working
// hand-built fixtures use (1 timeline entry = 1 match minute), keeping the
// most recent tick seen for each minute.
const byMinute = new Map();
for (const tick of ticks) {
  byMinute.set(tick.minute, tick);
}

const minutes = [...byMinute.keys()].sort((a, b) => a - b);
if (minutes.length === 0) {
  console.error('No usable minute data resolved -- nothing to write.');
  process.exit(1);
}

let lastHomeGoals = 0;
let lastAwayGoals = 0;
const timeline = minutes.map((minute, i) => {
  const t = byMinute.get(minute);
  const events = [];
  if (i === 0) events.push({ type: 'kickoff' });
  if (t.score.home > lastHomeGoals) {
    events.push({ type: 'goal', team: HOME });
    lastHomeGoals = t.score.home;
  }
  if (t.score.away > lastAwayGoals) {
    events.push({ type: 'goal', team: AWAY });
    lastAwayGoals = t.score.away;
  }

  let period = 'first_half';
  if (minute >= 90) period = 'finished';
  else if (minute >= 45) period = 'second_half';

  return {
    seq: i,
    minute,
    period,
    score: t.score,
    events,
    odds: t.odds,
    clock_seconds: minute * 60,
    timestamp: t.timestamp,
  };
});

const fixture = {
  fixture_id: Number(FIXTURE_ID),
  home_team: HOME,
  away_team: AWAY,
  timeline,
};

const outDir = path.join(ROOT, 'src', 'lib', 'replays');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${FIXTURE_ID}.json`);
fs.writeFileSync(outPath, JSON.stringify(fixture, null, 2));

console.log(`\nWrote ${timeline.length} minute-by-minute entries to ${outPath}`);
console.log(`Minute span: ${minutes[0]} -> ${minutes[minutes.length - 1]}`);
console.log(`\nThis match (agent_match_id = "replay-${FIXTURE_ID}") will now load in the app.`);
