import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPLAYS_DIR = path.join(__dirname, 'replays');

// In-memory replay state per match
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
    throw new Error(`Replay fixture not found: ${fixturePath}`);
  }
  const content = fs.readFileSync(fixturePath, 'utf8');
  return JSON.parse(content);
}

/**
 * Initialize replay state for a match
 */
function initReplayState(fixtureId) {
  const fixture = loadFixture(fixtureId);
  return {
    fixture,
    currentIndex: 0,
    lastTickTime: Date.now(),
    tickIntervalMs: 8000, // Advance to next event every 8 seconds
    isFinished: false,
  };
}

/**
 * Synthesize odds from live score state
 * Since real odds feed was empty, we create plausible odds based on score differential
 */
function synthesizeOdds(score, minute) {
  const goalDiff = score.home - score.away;
  let baseOdds = 1.9; // Starting odds for even match
  
  // Adjust based on goal difference
  if (goalDiff > 0) {
    baseOdds = 1.9 - (goalDiff * 0.3); // Home winning -> odds shorten
  } else if (goalDiff < 0) {
    baseOdds = 1.9 + (Math.abs(goalDiff) * 0.3); // Away winning -> odds lengthen
  }
  
  // Time decay: odds drift toward 1.0 as match progresses
  const timeDecay = Math.max(0, (120 - minute) / 120) * 0.2;
  baseOdds = baseOdds - timeDecay;
  
  // Add small random jitter for realism
  const jitter = (Math.random() - 0.5) * 0.05;
  baseOdds = baseOdds + jitter;
  
  // Clamp to reasonable bounds
  return Math.max(1.05, Math.min(5.0, Number(baseOdds.toFixed(3))));
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
  
  // Get or initialize replay state
  let state = replayStates.get(matchId);
  if (!state) {
    state = initReplayState(fixtureId);
    replayStates.set(matchId, state);
  }
  
  const now = Date.now();
  const timeSinceLastTick = now - state.lastTickTime;
  
  // Check if it's time to advance to next event
  if (timeSinceLastTick >= state.tickIntervalMs && !state.isFinished) {
    state.currentIndex++;
    state.lastTickTime = now;
    
    // Check if we've reached the end
    if (state.currentIndex >= state.fixture.timeline.length) {
      state.isFinished = true;
      state.currentIndex = state.fixture.timeline.length - 1; // Hold at final state
    }
  }
  
  const currentEvent = state.fixture.timeline[state.currentIndex];
  
  // Build event description from timeline events
  let eventDesc = null;
  if (currentEvent.events && currentEvent.events.length > 0) {
    const mainEvent = currentEvent.events[0];
    eventDesc = `${mainEvent.type}${mainEvent.team ? ` ${mainEvent.team}` : ''}`;
  }
  
  // Synthesize odds since real odds feed was empty
  const odds = synthesizeOdds(currentEvent.score, currentEvent.minute);
  
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
 * Reset replay state for a match (useful for restarting replay)
 */
export function resetReplay(matchId) {
  replayStates.delete(matchId);
}
