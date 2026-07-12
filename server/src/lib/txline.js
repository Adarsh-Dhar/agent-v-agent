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
 * Fetches the latest odds snapshot for a match from TxLINE.
 * Falls back to a mock random-walk feed if no API credentials are configured,
 * so the agent runner can be demoed end-to-end without live credentials.
 */
export async function fetchOddsSnapshot(matchId) {
  // Fallback to mock if credentials not configured
  if (!TXLINE_API_ORIGIN || !TXLINE_WALLET_KEYPAIR_PATH) {
    return mockTick();
  }

  try {
    const data = await txlineRequest(`/api/v1/matches/${matchId}/odds/live`);
    return {
      match_id: matchId,
      odds: data.odds || data.price || 1.9,
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
