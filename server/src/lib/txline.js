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
 * Market Focus resolver: given a raw TxLINE odds payload (or a mock snapshot
 * shaped like one) and an agent's market_focus/ah_line_band/ou_line_band,
 * pick the right price out of it.
 * [FEED-SHAPE TBD]: real TxLINE responses may expose `data.markets` /
 * `data.superOdds` (name TBD pending API docs) as an array of
 * { type: '1x2'|'asian_handicap'|'over_under', line, homeOdds, awayOdds, ... }.
 * Until that shape is confirmed against a live response, this falls back to
 * the single `data.odds` field for every market_focus value except when the
 * array is present, in which case it filters by type + line band.
 */
function resolveMarketOdds(data, agent) {
  const marketFocus = agent.market_focus || '1x2';
  const markets = data.markets || data.superOdds; // name TBD, see note above
  if (!Array.isArray(markets) || markets.length === 0) {
    return data.odds || data.price || 1.9; // no multi-market data available, fall back
  }
  if (marketFocus === '1x2') {
    return markets.find((m) => m.type === '1x2')?.price ?? data.odds ?? 1.9;
  }
  if (marketFocus === 'asian_handicap') {
    const band = agent.ah_line_band || 'tight';
    const candidates = markets.filter((m) => m.type === 'asian_handicap');
    const sorted = [...candidates].sort((a, b) => Math.abs(a.line) - Math.abs(b.line));
    const pick = band === 'tight' ? sorted[0] : sorted[sorted.length - 1];
    return pick?.price ?? data.odds ?? 1.9;
  }
  if (marketFocus === 'over_under') {
    const band = agent.ou_line_band || 'mid';
    const candidates = markets.filter((m) => m.type === 'over_under');
    const sorted = [...candidates].sort((a, b) => a.line - b.line);
    const idx = band === 'low' ? 0 : band === 'high' ? sorted.length - 1 : Math.floor(sorted.length / 2);
    return sorted[idx]?.price ?? data.odds ?? 1.9;
  }
  // multi_market: return the full array; strategyEngine decides per-tick which to act on.
  return markets;
}

/**
 * Fetches the latest odds snapshot for a match from TxLINE.
 * Routes to replay engine for replay matches (format: replay-{fixture-id}).
 * Falls back to a mock random-walk feed if no API credentials are configured,
 * so the agent runner can be demoed end-to-end without live credentials.
 */
export async function fetchOddsSnapshot(matchId, agent = {}) {
  // Check if this is a replay match
  if (isReplayMatch(matchId)) {
    return fetchReplaySnapshot(matchId);
  }

  // Use mock feed if TXLINE_MOCK_DATASET is set (regardless of API credentials)
  if (process.env.TXLINE_MOCK_DATASET) {
    return mockTick();
  }

  // Fallback to mock if credentials not configured
  if (!TXLINE_API_ORIGIN || !TXLINE_WALLET_KEYPAIR_PATH) {
    return mockTick();
  }

  try {
    const data = await txlineRequest(`/api/v1/matches/${matchId}/odds/live`);
    return {
      match_id: matchId,
      odds: resolveMarketOdds(data, agent),
      score: data.score || { home: 0, away: 0 },
      minute: data.minute || 0,
      event: data.event || null,
      timestamp: data.timestamp || new Date().toISOString(),
    };
  } catch (error) {
    log('TxLINE request failed, falling back to mock:', error.message);
    return mockTick();
  }
}
