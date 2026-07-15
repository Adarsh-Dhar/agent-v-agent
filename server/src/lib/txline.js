import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import nacl from 'tweetnacl';
import * as anchor from '@coral-xyz/anchor';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { isReplayMatch, fetchReplaySnapshot } from './txlineReplay.js';
import { createMockArgentinaSwitzerlandFeed } from './mockTxlineFeed.js';

dotenv.config();

const TXLINE_NETWORK = process.env.TXLINE_NETWORK || 'devnet';
const TXLINE_API_ORIGIN = process.env.TXLINE_API_ORIGIN;
const TXLINE_WALLET_KEYPAIR_PATH = process.env.TXLINE_WALLET_KEYPAIR_PATH;
const TXLINE_SUBSCRIBE_TX_SIG = process.env.TXLINE_SUBSCRIBE_TX_SIG;
let TXLINE_API_TOKEN = process.env.TXLINE_API_TOKEN;
let JWT = null;

const NETWORK_CONFIG = {
  mainnet: {
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    programId: new PublicKey('9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA'),
    txlTokenMint: new PublicKey('Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL'),
  },
  devnet: {
    rpcUrl: 'https://api.devnet.solana.com',
    programId: new PublicKey('6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J'),
    txlTokenMint: new PublicKey('4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG'),
  },
};

// Simple in-memory mock so you can run/demo the whole pipeline before wiring
// real TxLINE credentials. Odds random-walk around a starting value.
let mockOdds = 1.9;
function plainRandomWalkTick() {
  const drift = (Math.random() - 0.5) * 0.08;
  mockOdds = Math.max(1.05, mockOdds + drift);
  return {
    match_id: 'mock-match',
    odds: Number(mockOdds.toFixed(3)),
    score: { home: 0, away: 0 },
    minute: Math.floor(Math.random() * 90),
    event: null,
    timestamp: new Date().toISOString(),
    isMock: true,
  };
}

// Scripted mock feed support
let scriptedMockTick = null;
function mockTick() {
  if (process.env.TXLINE_MOCK_DATASET === 'arg-vs-sui') {
    if (!scriptedMockTick) scriptedMockTick = createMockArgentinaSwitzerlandFeed();
    return scriptedMockTick();
  }
  return plainRandomWalkTick();
}

function log(...msg) {
  console.log('[txline]', ...msg);
}

// Check if TxLINE is configured
export const isConfigured = !!(
  TXLINE_API_ORIGIN &&
  TXLINE_WALLET_KEYPAIR_PATH &&
  TXLINE_SUBSCRIBE_TX_SIG &&
  TXLINE_API_TOKEN
);

async function loadKeypair() {
  if (!TXLINE_WALLET_KEYPAIR_PATH) {
    throw new Error('TXLINE_WALLET_KEYPAIR_PATH not set in .env');
  }
  const secret = JSON.parse(fs.readFileSync(TXLINE_WALLET_KEYPAIR_PATH, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

/**
 * One-time activation of API token using the on-chain subscription signature.
 * This can only be called once per txSig - the returned token must be saved to .env.
 * For runtime JWT refresh, use refreshJwt() instead.
 */
async function activateToken() {
  if (!TXLINE_API_ORIGIN || !TXLINE_SUBSCRIBE_TX_SIG) {
    throw new Error('TXLINE_API_ORIGIN or TXLINE_SUBSCRIBE_TX_SIG not set in .env');
  }

  log('Requesting guest JWT...');
  const authResponse = await axios.post(`${TXLINE_API_ORIGIN}/auth/guest/start`);
  JWT = authResponse.data.token;

  log('Activating API token...');
  const keypair = await loadKeypair();
  const messageString = `${TXLINE_SUBSCRIBE_TX_SIG}::${JWT}`;
  const message = new TextEncoder().encode(messageString);
  const signatureBytes = nacl.sign.detached(message, keypair.secretKey);
  const walletSignature = Buffer.from(signatureBytes).toString('base64');

  const activationResponse = await axios.post(
    `${TXLINE_API_ORIGIN}/api/token/activate`,
    { txSig: TXLINE_SUBSCRIBE_TX_SIG, walletSignature, leagues: [] },
    { headers: { Authorization: `Bearer ${JWT}` } }
  );

  TXLINE_API_TOKEN = activationResponse.data.token || activationResponse.data;
  log('API token activated successfully');
  return TXLINE_API_TOKEN;
}

/**
 * Refresh the short-lived JWT only. Does NOT call /api/token/activate.
 * Used when JWT expires (401) but the API token is still valid.
 */
async function refreshJwt() {
  if (!TXLINE_API_ORIGIN) {
    throw new Error('TXLINE_API_ORIGIN not set in .env');
  }

  log('Refreshing JWT...');
  const authResponse = await axios.post(`${TXLINE_API_ORIGIN}/auth/guest/start`);
  JWT = authResponse.data.token;
  log('JWT refreshed successfully');
}

/**
 * Generic authenticated request to TxLINE API with JWT refresh on 401.
 * Reused by fetchOddsSnapshot and logTxlineData.js.
 */
export async function txlineRequest(endpoint) {
  if (!TXLINE_API_TOKEN) {
    throw new Error('TXLINE_API_TOKEN not set in .env - run `npm run activate:txline` first to activate your subscription and save the token.');
  }

  try {
    const headers = {
      'X-Api-Token': TXLINE_API_TOKEN,
    };

    if (JWT) {
      headers['Authorization'] = `Bearer ${JWT}`;
    }

    const res = await axios.get(`${TXLINE_API_ORIGIN}${endpoint}`, { headers });
    return res.data;
  } catch (error) {
    // If JWT expired (401), refresh it and retry with same API token
    if (error.response?.status === 401) {
      log('JWT expired, refreshing...');
      try {
        await refreshJwt();
        // Retry with same API token, new JWT
        const headers = {
          'X-Api-Token': TXLINE_API_TOKEN,
          'Authorization': `Bearer ${JWT}`,
        };
        const res = await axios.get(`${TXLINE_API_ORIGIN}${endpoint}`, { headers });
        return res.data;
      } catch (retryError) {
        log('JWT refresh failed:', retryError.message);
        throw retryError;
      }
    }
    throw error;
  }
}

/**
 * Market Focus resolver: given the RAW array returned by
 * GET /api/odds/snapshot/{fixtureId} and an agent's
 * market_focus/ah_line_band/ou_line_band, pick the right price out of it.
 *
 * CONFIRMED real shape (from a live fetch against fixture 18237038,
 * France vs Spain, 2026-07-14): the response is not `{ markets: [...] }` —
 * the top-level payload itself IS the array. Each element looks like:
 *   {
 *     FixtureId, SuperOddsType: '1X2_PARTICIPANT_RESULT' | 'ASIANHANDICAP_PARTICIPANT_GOALS' | 'OVERUNDER_PARTICIPANT_GOALS',
 *     MarketPeriod: 'half=1' | null,   // null = full match
 *     MarketParameters: 'line=-0.5' | null,
 *     PriceNames: ['part1','draw','part2'] | ['part1','part2'] | ['over','under'],
 *     Prices: [5394, 3628, 1855],       // decimal odds x1000 -- divide by 1000
 *     ...
 *   }
 * There is no separate "1x2" market name; use SuperOddsType and always
 * restrict to MarketPeriod === null (full match) unless a half-specific
 * market is explicitly wanted.
 */
function parseLine(marketParameters) {
  // "line=-0.5" -> -0.5 ; null -> null
  if (!marketParameters) return null;
  const match = /line=(-?[\d.]+)/.exec(marketParameters);
  return match ? Number(match[1]) : null;
}

function priceFor(market, priceName) {
  if (!market) return null;
  const idx = market.PriceNames?.indexOf(priceName);
  if (idx == null || idx < 0) return null;
  const raw = market.Prices?.[idx];
  return typeof raw === 'number' ? raw / 1000 : null; // Prices are decimal odds x1000
}

export function resolveMarketOdds(marketsArray, agent) {
  const marketFocus = agent.market_focus || '1x2';

  if (!Array.isArray(marketsArray) || marketsArray.length === 0) {
    return null; // caller decides the fallback; do not silently invent 1.9 here
  }

  const fullMatch = (m) => m.MarketPeriod === null || m.MarketPeriod === undefined;

  if (marketFocus === '1x2') {
    const market = marketsArray.find((m) => m.SuperOddsType === '1X2_PARTICIPANT_RESULT' && fullMatch(m));
    // 'part1' = home (Participant1IsHome per fixtures feed), 'part2' = away.
    return priceFor(market, 'part1');
  }

  if (marketFocus === 'asian_handicap') {
    const band = agent.ah_line_band || 'tight';
    const candidates = marketsArray.filter((m) => m.SuperOddsType === 'ASIANHANDICAP_PARTICIPANT_GOALS' && fullMatch(m));
    const withLines = candidates
      .map((m) => ({ m, line: parseLine(m.MarketParameters) }))
      .filter((x) => x.line !== null);
    const sorted = [...withLines].sort((a, b) => Math.abs(a.line) - Math.abs(b.line));
    const pick = band === 'tight' ? sorted[0] : sorted[sorted.length - 1];
    return priceFor(pick?.m, 'part1');
  }

  if (marketFocus === 'over_under') {
    const band = agent.ou_line_band || 'mid';
    const candidates = marketsArray.filter((m) => m.SuperOddsType === 'OVERUNDER_PARTICIPANT_GOALS' && fullMatch(m));
    const withLines = candidates
      .map((m) => ({ m, line: parseLine(m.MarketParameters) }))
      .filter((x) => x.line !== null);
    const sorted = [...withLines].sort((a, b) => a.line - b.line);
    const idx = band === 'low' ? 0 : band === 'high' ? sorted.length - 1 : Math.floor(sorted.length / 2);
    return priceFor(sorted[idx]?.m, 'over');
  }

  // multi_market: hand the whole raw array back. strategyEngine must be the
  // one deciding per-tick which market to act on for this mode -- do NOT
  // let this array reach the numeric pctChange math in evaluateSignal()
  // un-narrowed, or it will break (NaN) since it expects a number.
  return marketsArray;
}

/**
 * GET /api/scores/snapshot/{fixtureId} does NOT return entries in
 * chronological order. Confirmed against two independent fixtures
 * (18222446 Argentina-Switzerland, 18237038 France-Spain): entries are one-
 * per-distinct-Action-type, sorted ALPHABETICALLY by Action name
 * ("action_amend", "action_discarded", "additional_time", "attack_possession",
 * ... "yellow_card"), not by Ts/time. Taking scores[scores.length-1] or
 * scores[0] picks whichever action name is last/first alphabetically, which
 * has nothing to do with what actually happened most recently.
 * The correct approach: find the highest-Ts entry that actually carries a
 * Score object (many entries, e.g. 'connected'/'jersey'/'venue', don't).
 * 'game_finalised' is a special case -- it has no Clock field at all, so
 * minute has to fall back to whatever the last known clock was.
 */
export function extractLatestScoreState(scoresArray, previousMinute = 0) {
  if (!Array.isArray(scoresArray) || scoresArray.length === 0) {
    return { score: { home: 0, away: 0 }, minute: previousMinute, event: null, matchEnded: false };
  }

  const finalEvent = scoresArray.find((e) => e.Action === 'game_finalised' || e.StatusId === 100);
  const scoredEntries = scoresArray.filter((e) => e.Score);
  const latestScored = scoredEntries.length
    ? scoredEntries.reduce((a, b) => (b.Ts > a.Ts ? b : a))
    : null;

  const authoritative = finalEvent || latestScored;
  const score = authoritative
    ? {
        home: authoritative.Score?.Participant1?.Total?.Goals ?? 0,
        away: authoritative.Score?.Participant2?.Total?.Goals ?? 0,
      }
    : { home: 0, away: 0 };

  const minute = authoritative?.Clock?.Seconds != null
    ? Math.floor(authoritative.Clock.Seconds / 60)
    : previousMinute; // game_finalised has no Clock -- hold last known minute

  // Most recent event overall (by Ts), for score_state/anticipatory signals.
  const mostRecentOverall = scoresArray.reduce((a, b) => (b.Ts > a.Ts ? b : a));

  return {
    score,
    minute,
    event: mostRecentOverall?.Action ?? null,
    matchEnded: !!finalEvent,
  };
}

/**
 * Fetches the latest odds + score snapshot for a match from TxLINE and
 * merges them into the single tick shape agentRunner.js/strategyEngine.js
 * expect. Routes to replay engine for replay matches (format:
 * replay-{fixture-id}). Falls back to a mock feed if no credentials are
 * configured OR if either live call fails, so the pipeline still runs
 * end-to-end without live credentials -- but the fallback is now tagged
 * (`isMock: true`) instead of silently masquerading as real data.
 */
export async function fetchOddsSnapshot(fixtureId, agent = {}) {
  if (isReplayMatch(fixtureId)) {
    return fetchReplaySnapshot(fixtureId);
  }

  if (process.env.TXLINE_MOCK_DATASET) {
    return mockTick();
  }

  if (!TXLINE_API_ORIGIN || !TXLINE_WALLET_KEYPAIR_PATH || !TXLINE_API_TOKEN) {
    return { ...mockTick(), isMock: true };
  }

  try {
    const [oddsArray, scoresArray] = await Promise.all([
      txlineRequest(`/api/odds/snapshot/${fixtureId}`),
      txlineRequest(`/api/scores/snapshot/${fixtureId}`),
    ]);

    const odds = resolveMarketOdds(oddsArray, agent);
    if (odds === null) {
      log(`No open odds market for fixture ${fixtureId} (market_focus=${agent.market_focus || '1x2'}).`);
      return { ...mockTick(), isMock: true, mockReason: 'no_open_market' };
    }

    const { score, minute, event, matchEnded } = extractLatestScoreState(scoresArray, agent._lastKnownMinute ?? 0);

    return {
      match_id: fixtureId,
      odds,
      score,
      minute,
      event,
      matchEnded,
      timestamp: new Date().toISOString(),
      isMock: false,
    };
  } catch (error) {
    log('TxLINE request failed, falling back to mock:', error.message);
    return { ...mockTick(), isMock: true, mockReason: error.message };
  }
}
