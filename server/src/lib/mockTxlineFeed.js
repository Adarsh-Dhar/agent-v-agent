// mockTxlineFeed.js
//
// ============================================================================
// SYNTHETIC / TEST DATA ONLY — NOT A LIVE FEED
// ============================================================================
// This module does NOT talk to TxLINE or any real odds provider. It replays
// a fixed, already-completed match (Argentina 3-1 Switzerland, AET/pens,
// FixtureId 18222446) as a deterministic keyframe timeline, and synthesizes
// "odds" from a simple toy model. It exists purely so `agentRunner.js` can be
// exercised end-to-end locally while you don't have TxLINE credentials wired
// up yet (see the fallback note in README.md / txline.js).
//
// Every object this module returns should be treated as fake: the odds are
// not real market prices, and this must never be pointed at real users,
// real money, or presented anywhere as genuine market data.
// ============================================================================

// Keyframes taken directly from the uploaded match timeline (txline-full-output.txt).
// `minute` is match-clock minute (can exceed 90 in ET), `event` is the single most
// significant event associated with that keyframe (for the `score_state` signal).
// Timeline: 1st half (0-45) -> Half time (15) -> 2nd half (45-90) -> Extra time (90-120) -> Penalties
const KEYFRAMES = [
  { minute: 0,   score: { home: 0, away: 0 }, odds: { home: 1.90, away: 4.20 }, cards: { yh: 0, ya: 0, rh: 0, ra: 0 }, corners: { home: 0, away: 0 }, event: null,             period: '1st_half' },
  { minute: 44,  score: { home: 1, away: 0 }, cards: { yh: 0, ya: 1, rh: 0, ra: 0 }, corners: { home: 2, away: 1 }, event: 'goal_home',       period: '1st_half' },
  { minute: 45,  score: { home: 1, away: 0 }, cards: { yh: 0, ya: 1, rh: 0, ra: 0 }, corners: { home: 2, away: 1 }, event: null,              period: 'half_time' },
  { minute: 60,  score: { home: 1, away: 0 }, cards: { yh: 0, ya: 1, rh: 0, ra: 0 }, corners: { home: 2, away: 1 }, event: null,              period: '2nd_half' },
  { minute: 71,  score: { home: 1, away: 1 }, cards: { yh: 1, ya: 1, rh: 0, ra: 0 }, corners: { home: 3, away: 2 }, event: 'goal_away',       period: '2nd_half' },
  { minute: 71.5,score: { home: 1, away: 1 }, cards: { yh: 1, ya: 1, rh: 0, ra: 1 }, corners: { home: 3, away: 2 }, event: 'red_card_away',   period: '2nd_half' },
  { minute: 90,  score: { home: 1, away: 1 }, cards: { yh: 1, ya: 1, rh: 0, ra: 1 }, corners: { home: 6, away: 2 }, event: null,              period: 'extra_time' },
  { minute: 108, score: { home: 2, away: 1 }, cards: { yh: 3, ya: 1, rh: 0, ra: 1 }, corners: { home: 8, away: 2 }, event: 'goal_home',       period: 'extra_time' },
  { minute: 110, score: { home: 3, away: 1 }, cards: { yh: 3, ya: 1, rh: 0, ra: 1 }, corners: { home: 8, away: 2 }, event: 'goal_home',       period: 'extra_time' },
  { minute: 120, score: { home: 3, away: 1 }, cards: { yh: 3, ya: 2, rh: 0, ra: 1 }, corners: { home: 8, away: 2 }, event: null,              period: 'extra_time' },
  { minute: 120.5,score: { home: 3, away: 1 }, cards: { yh: 3, ya: 1, rh: 0, ra: 1 }, corners: { home: 8, away: 2 }, event: 'penalties',       period: 'penalties' },
  { minute: 121,score: { home: 3, away: 1 }, cards: { yh: 3, ya: 1, rh: 0, ra: 1 }, corners: { home: 8, away: 2 }, event: 'full_time',      period: 'ended' },
];

const TOTAL_MATCH_MINUTES = KEYFRAMES[KEYFRAMES.length - 1].minute;

// How long (wall-clock ms) a full replay takes. Override with
// TXLINE_MOCK_DURATION_MS in .env if you want a longer/shorter demo.
// Default: 3 minutes real time to replay the ~124 "match minutes".
const DEFAULT_DURATION_MS = 3 * 60 * 1000;

/**
 * A simple, clearly-synthetic odds model. NOT derived from any real market.
 * Returns the "center" price the random walk should hover around, based on:
 *  - score differential (each goal moves the price a fixed chunk)
 *  - a red card swinging things further
 *  - time remaining (odds converge as the match nears its end)
 *  - a small deterministic sine wobble
 * The continuous random-walk jitter is layered on top by the caller (see
 * stepRandomWalk / the tick() closure below) so the number changes on every
 * single call, indefinitely — not just when the scripted timeline advances.
 */
function syntheticOddsCenter(matchMinute, kf) {
  const diff = kf.score.home - kf.score.away;
  const redCardSwing = kf.cards.ra > 0 ? -0.25 : kf.cards.rh > 0 ? 0.25 : 0;
  const base = 2.0 - diff * 0.45 + redCardSwing;

  // Time-decay convergence: as matchMinute -> TOTAL_MATCH_MINUTES, odds
  // move toward whichever side is ahead (or 1.98 if level).
  const progress = Math.min(1, matchMinute / TOTAL_MATCH_MINUTES);
  const converged = diff === 0 ? 1.98 : diff > 0 ? 1.15 : 3.4;
  const timeAdjusted = base + (converged - base) * progress * 0.6;

  // Small deterministic wobble (sine wave keyed on minute) layered underneath
  // the random walk, so there's always *some* movement even if the random
  // walk happens to sit flat for a tick.
  const wobble = Math.sin(matchMinute * 1.7) * 0.03;

  return timeAdjusted + wobble;
}

/**
 * Continuous random-walk driver. Each call nudges `offset` by a small random
 * step and mean-reverts it gently toward 0 so it doesn't wander off forever.
 * This is what keeps the odds "always changing" tick after tick, even after
 * the scripted match timeline has finished playing out.
 */
function stepRandomWalk(prevOffset) {
  const step = (Math.random() - 0.5) * 0.05; // per-tick jitter
  const reverted = prevOffset * 0.85; // gentle pull back toward the model's center
  return reverted + step;
}

/**
 * Creates a mock feed generator. Call the returned function on each tick
 * (e.g. every POLL_INTERVAL_MS from agentRunner.js) to get the next
 * synthetic snapshot in the same shape fetchOddsSnapshot() normally returns.
 */
export function createMockArgentinaSwitzerlandFeed(options = {}) {
  const envDurationMs = Number(process.env.TXLINE_MOCK_DURATION_MS) || DEFAULT_DURATION_MS;
  const durationMs = options.durationMs ?? envDurationMs;
  const startedAt = Date.now();
  let lastEmittedEventMinute = -1;
  let walkOffset = 0; // continuous random-walk state, carried between ticks
  let halfTimeEntryMinute = null; // track match minute when entering half time
  let matchEnded = false; // flag to stop simulation when match ends

  return function tick() {
    const elapsed = Date.now() - startedAt;
    // Timeline itself still finishes after `durationMs` (matchMinute caps at
    // TOTAL_MATCH_MINUTES), but the odds keep jittering forever afterward —
    // the random walk below doesn't care whether the scripted match is over.
    const progress = Math.min(1, elapsed / durationMs);
    let matchMinute = Number((progress * TOTAL_MATCH_MINUTES).toFixed(2));

    // Most recent keyframe at or before the current match minute.
    let kf = KEYFRAMES[0];
    for (const candidate of KEYFRAMES) {
      if (candidate.minute <= matchMinute) kf = candidate;
      else break;
    }

    // Pause match minute during half_time (show 45')
    if (kf.period === 'half_time') {
      if (halfTimeEntryMinute === null) {
        halfTimeEntryMinute = 45; // always show 45 during half time
      }
      matchMinute = halfTimeEntryMinute;
    } else {
      halfTimeEntryMinute = null;
    }

    // Check if match has ended
    if (kf.period === 'ended') {
      matchEnded = true;
    }

    // Only surface an `event` the first tick that crosses a keyframe with one,
    // so evaluateSignal's score_state logic doesn't fire on every single tick.
    let event = null;
    if (kf.event && kf.minute !== lastEmittedEventMinute) {
      event = kf.event;
      lastEmittedEventMinute = kf.minute;
    }

    // Advance the random walk every single call, so odds are never identical
    // twice in a row — this is what makes the feed look continuously "live".
    walkOffset = stepRandomWalk(walkOffset);
    const center = syntheticOddsCenter(matchMinute, kf);
    const homeOdds = Math.max(1.02, Number((center + walkOffset).toFixed(3)));
    const awayOdds = Math.max(1.02, Number(((1 / center) + walkOffset * 0.5).toFixed(3)));

    return {
      match_id: 'mock-arg-vs-sui-2026',
      odds: { home: homeOdds, away: awayOdds },
      score: { home: kf.score.home, away: kf.score.away },
      minute: Math.min(120, Math.round(matchMinute)), // display clock caps like most feeds do
      event,
      period: kf.period,
      timestamp: new Date().toISOString(),
      matchEnded,
      // Explicit flags so nothing downstream can mistake this for a real feed.
      isMock: true,
      mockSource: 'Argentina vs Switzerland (fixture 18222446) — replayed timeline, synthetic odds',
    };
  };
}
