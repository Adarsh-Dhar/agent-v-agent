import dotenv from 'dotenv';
dotenv.config();

const TXLINE_API_URL = process.env.TXLINE_API_URL;
const TXLINE_API_KEY = process.env.TXLINE_API_KEY;

// Simple in-memory mock so you can run/demo the whole pipeline before wiring
// real TxLINE credentials. Odds random-walk around a starting value.
let mockOdds = 1.9;
function mockTick() {
  const drift = (Math.random() - 0.5) * 0.08;
  mockOdds = Math.max(1.05, mockOdds + drift);
  return {
    match_id: 'mock-match',
    odds: Number(mockOdds.toFixed(3)),
    score: { home: 0, away: 0 },
    minute: Math.floor(Math.random() * 90),
    event: null,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Fetches the latest odds snapshot for a match from TxLINE.
 * Falls back to a mock random-walk feed if no API key is configured,
 * so the agent runner can be demoed end-to-end without live credentials.
 */
export async function fetchOddsSnapshot(matchId) {
  if (!TXLINE_API_URL || !TXLINE_API_KEY) {
    return mockTick();
  }

  const res = await fetch(`${TXLINE_API_URL}/v1/matches/${matchId}/odds/live`, {
    headers: { Authorization: `Bearer ${TXLINE_API_KEY}` },
  });

  if (!res.ok) {
    throw new Error(`TxLINE request failed: ${res.status} ${res.statusText}`);
  }

  // NOTE: adjust this mapping to TxLINE's actual normalized JSON schema
  // once you've checked the quickstart docs - this is a reasonable guess
  // at shape (odds, score, minute, event) based on the listing description.
  return res.json();
}
