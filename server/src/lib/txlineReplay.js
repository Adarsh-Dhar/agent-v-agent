import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getMatchEpoch } from './matchClock.js';
import { resolveMarketOdds, extractLatestScoreState, priceFor } from './txline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPLAYS_DIR = path.join(__dirname, 'replays');
const LOGS_DIR = path.resolve(__dirname, '../../logs');

const TICK_INTERVAL_MS = 1000;

const LOG_FIXTURE_MAP = {
  '99999999': '18241006',
};

const replayStates = new Map();

export function isReplayMatch(matchId) {
  return matchId?.startsWith('replay-');
}

function extractFixtureId(matchId) {
  if (!isReplayMatch(matchId)) return null;
  return matchId.replace('replay-', '');
}

function loadFixture(fixtureId) {
  const fixturePath = path.join(REPLAYS_DIR, `${fixtureId}.json`);
  if (!fs.existsSync(fixturePath)) {
    const available = fs.existsSync(REPLAYS_DIR)
      ? fs.readdirSync(REPLAYS_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''))
      : [];
    throw new Error(
      `Replay fixture not found: ${fixturePath}. Available fixture ids: [${available.join(', ') || 'none'}]. ` +
        `Create server/src/lib/replays/${fixtureId}.json (see scripts/buildReplayFixture.js) or point this match at one of the available ids.`
    );
  }
  const content = fs.readFileSync(fixturePath, 'utf8');
  return JSON.parse(content);
}

function synthesizeOdds(score, minute) {
  const goalDiff = score.home - score.away;
  let baseOdds = 1.9;
  if (goalDiff > 0) {
    baseOdds = 1.9 - (goalDiff * 0.6);
  } else if (goalDiff < 0) {
    baseOdds = 1.9 + (Math.abs(goalDiff) * 0.6);
  }
  const timePressure = Math.min(1, minute / 90);
  const volatilityMultiplier = 1 + (timePressure * 1.5);
  const timeDecay = Math.max(0, (120 - minute) / 120) * 0.5;
  baseOdds = baseOdds - timeDecay;
  const jitter = (Math.random() - 0.5) * 0.15 * volatilityMultiplier;
  baseOdds = baseOdds + jitter;
  if (minute >= 40 && minute <= 45) {
    baseOdds += (Math.random() - 0.5) * 0.2;
  } else if (minute >= 85 && minute <= 90) {
    baseOdds += (Math.random() - 0.5) * 0.3;
  }
  return Math.max(1.01, Math.min(8.0, Number(baseOdds.toFixed(3))));
}

function loadJsonlFiles(kind) {
  if (!fs.existsSync(LOGS_DIR)) return [];
  const files = fs.readdirSync(LOGS_DIR)
    .filter((f) => f.startsWith(`txline-${kind}-`) && f.endsWith('.jsonl'))
    .sort()
    .map((f) => path.join(LOGS_DIR, f));
  return files.flatMap((fp) =>
    fs.readFileSync(fp, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean)
  );
}

function buildTimelineFromLogs(fixtureId, fixture) {
  const logFixtureId = LOG_FIXTURE_MAP[fixtureId] || fixtureId;
  const numId = Number(logFixtureId);
  const isSwapped = fixtureId !== logFixtureId;
  const oddsEntries = loadJsonlFiles('odds');
  const scoresEntries = loadJsonlFiles('scores');

  const fixtureOdds = oddsEntries
    .map((e) => ({ ...e, data: (e.data || []).filter((m) => m.FixtureId === numId) }))
    .filter((e) => e.data.length > 0);

  const fixtureScores = scoresEntries
    .map((e) => ({
      ...e,
      data: (Array.isArray(e.data) ? e.data : [e.data]).filter((s) => s.FixtureId === numId),
    }))
    .filter((e) => e.data.length > 0);

  if (fixtureOdds.length === 0) return null;

  // Pre-build score timeline: process ALL score entries chronologically
  // maintaining running minute/score state, instead of nearest-neighbor lookup.
  const scoreTimeline = [];
  let runningMinute = 0;
  let runningScore = { home: 0, away: 0 };

  for (const entry of fixtureScores) {
    const result = extractLatestScoreState(entry.data, runningMinute);
    runningMinute = result.minute;
    runningScore = result.score;
    scoreTimeline.push({
      time: new Date(entry.fetched_at).getTime(),
      minute: result.minute,
      score: { ...result.score },
      event: result.event,
    });
  }

  // Merge odds + score timeline chronologically
  let scoreIdx = 0;
  const ticks = [];

  for (const entry of fixtureOdds) {
    let odds;
    if (isSwapped) {
      const market = entry.data.find((m) => m.SuperOddsType === '1X2_PARTICIPANT_RESULT' && (m.MarketPeriod === null || m.MarketPeriod === undefined));
      odds = priceFor(market, 'part2');
    } else {
      odds = resolveMarketOdds(entry.data, { market_focus: '1x2' });
    }
    if (odds === null) continue;

    const entryTime = new Date(entry.fetched_at).getTime();

    // Advance scoreIdx to the latest score entry at or before this time
    while (scoreIdx < scoreTimeline.length - 1 && scoreTimeline[scoreIdx + 1].time <= entryTime) {
      scoreIdx++;
    }

    const scoreState = scoreTimeline[scoreIdx] || scoreTimeline[0];

    ticks.push({
      odds,
      score: scoreState.score,
      minute: scoreState.minute,
      event: scoreState.event,
      timestamp: entry.fetched_at,
    });
  }

  if (ticks.length === 0) return null;

  const homeTeam = fixture.home_team || 'Home';
  const awayTeam = fixture.away_team || 'Away';
  let lastHomeGoals = 0;
  let lastAwayGoals = 0;

  const timeline = ticks.map((tick, i) => {
    const events = [];
    if (i === 0) events.push({ type: 'kickoff' });
    if (tick.score.home > lastHomeGoals) {
      events.push({ type: 'goal', team: homeTeam });
      lastHomeGoals = tick.score.home;
    }
    if (tick.score.away > lastAwayGoals) {
      events.push({ type: 'goal', team: awayTeam });
      lastAwayGoals = tick.score.away;
    }

    let period = 'first_half';
    if (tick.minute >= 105) period = 'penalty_shootout';
    else if (tick.minute >= 90) period = 'extra_time';
    else if (tick.minute >= 45) period = 'second_half';

    const displayScore = isSwapped
      ? { home: tick.score.away, away: tick.score.home }
      : tick.score;

    return {
      seq: i,
      minute: tick.minute,
      period,
      score: displayScore,
      events,
      odds: tick.odds,
      clock_seconds: tick.minute * 60,
      timestamp: tick.timestamp,
    };
  });

  return {
    fixture_id: Number(fixtureId),
    home_team: homeTeam,
    away_team: awayTeam,
    timeline,
  };
}

function initReplayState(fixtureId) {
  let fixture = loadFixture(fixtureId);

  const logTimeline = buildTimelineFromLogs(fixtureId, fixture);
  if (logTimeline) {
    console.log(`[replay-${fixtureId}] Loaded ${logTimeline.timeline.length} ticks from raw JSONL logs`);
    fixture = logTimeline;
  } else {
    console.log(`[replay-${fixtureId}] Using fixture JSON (${fixture.timeline.length} ticks)`);
  }

  return {
    fixture,
    isFinished: false,
  };
}

export async function fetchReplaySnapshot(matchId) {
  const fixtureId = extractFixtureId(matchId);
  if (!fixtureId) {
    throw new Error(`Invalid replay match ID: ${matchId}`);
  }

  let state = replayStates.get(matchId);
  if (!state) {
    state = initReplayState(fixtureId);
    replayStates.set(matchId, state);
  }

  const epoch = await getMatchEpoch(matchId);

  const elapsed = Date.now() - epoch;
  const rawIndex = Math.floor(elapsed / TICK_INTERVAL_MS);
  const lastIndex = state.fixture.timeline.length - 1;
  const currentIndex = Math.max(0, Math.min(rawIndex, lastIndex));

  if (currentIndex >= lastIndex) {
    state.isFinished = true;
  }

  const currentEvent = state.fixture.timeline[currentIndex];

  let eventDesc = null;
  if (currentEvent.events && currentEvent.events.length > 0) {
    const mainEvent = currentEvent.events[0];
    eventDesc = `${mainEvent.type}${mainEvent.team ? ` ${mainEvent.team}` : ''}`;
  }

  const odds = currentEvent.odds ?? synthesizeOdds(currentEvent.score, currentEvent.minute);

  return {
    match_id: matchId,
    odds,
    score: currentEvent.score,
    minute: currentEvent.minute,
    event: eventDesc,
    timestamp: new Date().toISOString(),
    period: currentEvent.period,
    is_replay: true,
  };
}

export function resetReplay(matchId) {
  replayStates.delete(matchId);
}
