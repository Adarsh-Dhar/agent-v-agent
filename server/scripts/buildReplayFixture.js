#!/usr/bin/env node
/**
 * scripts/buildReplayFixture.js
 *
 * Parses raw TxLINE score JSONL logs and builds a clean, ordered replay fixture.
 * The raw scores are partial deltas (action_amend) - this script walks them in
 * Seq order, diffs cumulative goals/cards, and emits a clean event timeline.
 *
 * Usage:
 *   node scripts/buildReplayFixture.js --fixture-id 18241006 --log logs/txline-scores-2026-07-12.jsonl --home Argentina --away Switzerland
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { fixtureId: null, logPath: null, home: null, away: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--fixture-id') out.fixtureId = args[++i];
    else if (args[i] === '--log') out.logPath = args[++i];
    else if (args[i] === '--home') out.home = args[++i];
    else if (args[i] === '--away') out.away = args[++i];
  }
  return out;
}

function loadJsonl(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content
    .trim()
    .split('\n')
    .map(line => {
      try {
        return JSON.parse(line);
      } catch (e) {
        console.warn('Failed to parse line:', line.slice(0, 100));
        return null;
      }
    })
    .filter(Boolean);
}

function extractScoresForFixture(entries, fixtureId) {
  const scores = [];
  for (const entry of entries) {
    if (entry.kind !== 'scores') continue;
    const data = entry.data;
    const list = Array.isArray(data) ? data : [data];
    for (const item of list) {
      if (item.FixtureId === Number(fixtureId)) {
        scores.push(item);
      }
    }
  }
  return scores;
}

function dedupeAndSort(scores) {
  const seen = new Set();
  const unique = [];
  for (const s of scores) {
    const key = `${s.Seq}_${s.Ts}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(s);
    }
  }
  return unique.sort((a, b) => (a.Seq || 0) - (b.Seq || 0));
}

function buildTimeline(scores, homeTeam, awayTeam) {
  const timeline = [];
  let lastHomeGoals = 0;
  let lastAwayGoals = 0;
  let lastHomeYellows = 0;
  let lastAwayYellows = 0;
  let lastAwayReds = 0;
  const seenMinutes = new Set();

  for (const score of scores) {
    const p1 = score.Score?.Participant1 || {};
    const p2 = score.Score?.Participant2 || {};
    
    const homeGoals = p1.Total?.Goals || 0;
    const awayGoals = p2.Total?.Goals || 0;
    const homeYellows = p1.Total?.YellowCards || 0;
    const awayYellows = p2.Total?.YellowCards || 0;
    const awayReds = p2.Total?.RedCards || 0;
    
    const clockSeconds = score.Clock?.Seconds || 0;
    const minute = Math.floor(clockSeconds / 60);
    
    const events = [];
    
    // Detect goal changes
    if (homeGoals > lastHomeGoals) {
      events.push({ type: 'goal', team: homeTeam, count: homeGoals - lastHomeGoals });
      lastHomeGoals = homeGoals;
    }
    if (awayGoals > lastAwayGoals) {
      events.push({ type: 'goal', team: awayTeam, count: awayGoals - lastAwayGoals });
      lastAwayGoals = awayGoals;
    }
    
    // Detect card changes
    if (homeYellows > lastHomeYellows) {
      events.push({ type: 'yellow_card', team: homeTeam, count: homeYellows - lastHomeYellows });
      lastHomeYellows = homeYellows;
    }
    if (awayYellows > lastAwayYellows) {
      events.push({ type: 'yellow_card', team: awayTeam, count: awayYellows - lastAwayYellows });
      lastAwayYellows = awayYellows;
    }
    if (awayReds > lastAwayReds) {
      events.push({ type: 'red_card', team: awayTeam, count: awayReds - lastAwayReds });
      lastAwayReds = awayReds;
    }
    
    // Detect period transitions based on clock
    let period = 'first_half';
    if (minute >= 120) period = 'finished';
    else if (minute >= 105) period = 'extra_time_2nd';
    else if (minute >= 90) period = 'extra_time_1st';
    else if (minute >= 45) period = 'second_half';
    
    // Only add to timeline if there are events
    if (events.length > 0) {
      const key = `${minute}_${homeGoals}_${awayGoals}`;
      if (!seenMinutes.has(key)) {
        seenMinutes.add(key);
        timeline.push({
          seq: score.Seq,
          minute,
          period,
          score: { home: homeGoals, away: awayGoals },
          events,
          clock_seconds: clockSeconds,
          timestamp: score.Ts,
        });
      }
    }
  }
  
  // Add kickoff and final markers
  if (timeline.length > 0) {
    timeline.unshift({
      seq: 0,
      minute: 0,
      period: 'first_half',
      score: { home: 0, away: 0 },
      events: [{ type: 'kickoff' }],
      clock_seconds: 0,
      timestamp: timeline[0].timestamp,
    });
    
    const final = timeline[timeline.length - 1];
    timeline.push({
      seq: final.seq + 1,
      minute: 120,
      period: 'finished',
      score: final.score,
      events: [{ type: 'full_time' }],
      clock_seconds: 7200,
      timestamp: final.timestamp,
    });
  }
  
  return timeline;
}

async function main() {
  const { fixtureId, logPath, home, away } = parseArgs();
  
  if (!fixtureId || !logPath || !home || !away) {
    console.error('Usage: node scripts/buildReplayFixture.js --fixture-id <id> --log <path> --home <team> --away <team>');
    process.exit(1);
  }
  
  console.log(`Loading scores from ${logPath}...`);
  const entries = loadJsonl(logPath);
  
  console.log(`Extracting scores for fixture ${fixtureId}...`);
  const scores = extractScoresForFixture(entries, fixtureId);
  console.log(`Found ${scores.length} score records`);
  
  console.log('Deduping and sorting by Seq...');
  const uniqueScores = dedupeAndSort(scores);
  console.log(`After dedupe: ${uniqueScores.length} unique records`);
  
  console.log('Building timeline...');
  const timeline = buildTimeline(uniqueScores, home, away);
  console.log(`Generated ${timeline.length} timeline events`);
  
  const outputDir = path.join(ROOT, 'src', 'lib', 'replays');
  fs.mkdirSync(outputDir, { recursive: true });
  
  const outputPath = path.join(outputDir, `${fixtureId}.json`);
  const fixture = {
    fixture_id: fixtureId,
    home_team: home,
    away_team: away,
    timeline,
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(fixture, null, 2));
  console.log(`\nReplay fixture written to ${outputPath}`);
  
  // Print summary
  console.log('\nTimeline summary:');
  timeline.forEach((t, i) => {
    const eventStr = t.events ? t.events.map(e => `${e.type}${e.team ? ` (${e.team})` : ''}`).join(', ') : 'period marker';
    console.log(`  ${i + 1}. ${t.minute}' [${t.period}] ${t.score.home}-${t.score.away} - ${eventStr}`);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
