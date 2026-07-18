import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getMatchEpoch } from './matchClock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPLAYS_DIR = path.join(__dirname, 'replays');

// Advance to the next timeline event every 1 second of wall-clock time, so
// minute N of the match fires at second N of the replay -- same pacing as
// scripts/liveReplayMatch.js, just driven by the shared epoch instead of a
// local setInterval so every agent process stays in lockstep.
const TICK_INTERVAL_MS = 1000;

// In-memory cache per match: just the loaded fixture + a "finished" latch.
// Notably, this NO LONGER holds a per-process currentIndex/lastTickTime --
// those used to be incremented locally on each tick, which is exactly what
// let different agents' processes drift apart from each other. The timeline
// position is now derived fresh on every call from the shared epoch (see
// getMatchEpoch below), so every process -- no matter when it started
// polling -- computes the identical index for a given wall-clock time.
const replayStates = new Map();

/**
 * Check if a match ID is a replay match (format: replay-{fixture-id})
 */
export function isReplayMatch(matchId) {
  return matchId?.startsWith('replay-');
}

/**
 * Extract fixture ID from replay match ID
 */
function extractFixtureId(matchId) {
  if (!isReplayMatch(matchId)) return null;
  return matchId.replace('replay-', '');
}

/**
 * Load a replay fixture from disk
 */
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

/**
 * Initialize (process-local) replay state for a match: just the loaded
 * fixture data. No timing state lives here anymore -- see module header.
 */
function initReplayState(fixtureId) {
  const fixture = loadFixture(fixtureId);
  return {
    fixture,
    isFinished: false,
  };
}

/**
 * Synthesize odds from live score state
 * Since real odds feed was empty, we create plausible odds based on score differential
 * Made more eventful with higher volatility and dramatic swings
 */
function synthesizeOdds(score, minute) {
  const goalDiff = score.home - score.away;
  let baseOdds = 1.9; // Starting odds for even match
  
  // Adjust based on goal difference - much more dramatic swings
  if (goalDiff > 0) {
    baseOdds = 1.9 - (goalDiff * 0.6); // Home winning -> odds shorten significantly
  } else if (goalDiff < 0) {
    baseOdds = 1.9 + (Math.abs(goalDiff) * 0.6); // Away winning -> odds lengthen significantly
  }
  
  // Time pressure: odds become more volatile as match progresses
  const timePressure = Math.min(1, minute / 90);
  const volatilityMultiplier = 1 + (timePressure * 1.5); // 1x to 2.5x volatility
  
  // Dramatic time decay: odds drift toward 1.0 as match progresses
  const timeDecay = Math.max(0, (120 - minute) / 120) * 0.5;
  baseOdds = baseOdds - timeDecay;
  
  // Add larger random jitter for realism and excitement
  const jitter = (Math.random() - 0.5) * 0.15 * volatilityMultiplier;
  baseOdds = baseOdds + jitter;
  
  // Add momentum swings based on minute (more volatility in key periods)
  if (minute >= 40 && minute <= 45) {
    // First half injury time chaos
    baseOdds += (Math.random() - 0.5) * 0.2;
  } else if (minute >= 85 && minute <= 90) {
    // Final minutes desperation
    baseOdds += (Math.random() - 0.5) * 0.3;
  }
  
  // Clamp to reasonable bounds but allow wider range
  return Math.max(1.01, Math.min(8.0, Number(baseOdds.toFixed(3))));
}

/**
 * Get the next replay snapshot for a match
 * Advances through the timeline based on time intervals
 */
export async function fetchReplaySnapshot(matchId) {
  const fixtureId = extractFixtureId(matchId);
  if (!fixtureId) {
    throw new Error(`Invalid replay match ID: ${matchId}`);
  }
  
  // Get or initialize (process-local) fixture state
  let state = replayStates.get(matchId);
  if (!state) {
    state = initReplayState(fixtureId);
    replayStates.set(matchId, state);
  }

  // Shared, race-safe start time for this match_id. Every process trading
  // this match -- no matter which one asked first, or how many seconds late
  // a later process's spawn/connect happened -- gets back the exact same
  // epoch, because it's elected once in Supabase (see matchClock.js).
  const epoch = await getMatchEpoch(matchId);

  // Timeline index is a pure function of elapsed wall-clock time since the
  // shared epoch, NOT a counter incremented per-tick. This is what makes it
  // self-correcting: it doesn't matter if a tick was slow, missed, or this
  // is the very first call from a process that joined late -- every reader
  // converges on the same index for the same wall-clock moment.
  const elapsed = Date.now() - epoch;
  const rawIndex = Math.floor(elapsed / TICK_INTERVAL_MS);
  const lastIndex = state.fixture.timeline.length - 1;
  const currentIndex = Math.max(0, Math.min(rawIndex, lastIndex));

  if (currentIndex >= lastIndex) {
    state.isFinished = true;
  }

  const currentEvent = state.fixture.timeline[currentIndex];
  
  // Build event description from timeline events
  let eventDesc = null;
  if (currentEvent.events && currentEvent.events.length > 0) {
    const mainEvent = currentEvent.events[0];
    eventDesc = `${mainEvent.type}${mainEvent.team ? ` ${mainEvent.team}` : ''}`;
  }
  
  // Use real fixture odds if present; fall back to synthetic only when
  // the fixture doesn't include an odds field (backwards compat).
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

/**
 * Reset (process-local) replay state for a match. This only clears this
 * process's cached fixture/isFinished latch -- the shared start epoch in
 * Supabase is untouched, so other processes' timelines are unaffected and
 * this process will pick up exactly where the shared clock says it should.
 * To actually restart a match's clock for everyone, call
 * matchClock.resetMatchEpoch(matchId) explicitly.
 */
export function resetReplay(matchId) {
  replayStates.delete(matchId);
}
