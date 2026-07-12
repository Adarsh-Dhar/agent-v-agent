#!/usr/bin/env node
/**
 * scripts/logTxlineData.js
 *
 * Pulls all four TxLINE data types documented in the World Cup Free Tier
 * guide - Fixtures, Odds, Scores, and Validation Proofs - and logs them
 * both to the console and to a JSONL file on disk.
 *
 * Prerequisite: run `npm run activate:txline` first so TXLINE_API_ORIGIN /
 * TXLINE_WALLET_KEYPAIR_PATH / TXLINE_SUBSCRIBE_TX_SIG are set in .env.
 * If they aren't set, this script exits with instructions rather than
 * silently doing nothing.
 *
 * Usage:
 *   node scripts/logTxlineData.js                     # one-shot, auto-picks a fixture
 *   node scripts/logTxlineData.js --match-id wc-2026-final
 *   node scripts/logTxlineData.js --match-id wc-2026-final --poll 30
 *
 * --poll <seconds>  Keep running, re-fetching odds/scores/proofs on an
 *                    interval (fixtures are only refetched once per run
 *                    unless --match-id is omitted, since that list changes
 *                    far less often than in-play odds/scores).
 *
 * IMPORTANT - endpoint paths below are a best-effort guess built from the
 * quickstart/world-cup docs' description of the four data groups (Fixtures,
 * Odds, Scores, Validation Proofs) and the one confirmed odds route already
 * used in src/lib/txline.js. The full API Reference page wasn't fetchable
 * from here to verify every path byte-for-byte - open
 * https://txline.txodds.com/api-reference in your browser once and adjust
 * the ENDPOINTS block below if any path 404s.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isConfigured, txlineRequest } from '../src/lib/txline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');

// ---------------------------------------------------------------------------
// Endpoint config - real paths from TxLINE docs (Fetching Snapshots page)
// ---------------------------------------------------------------------------
const ENDPOINTS = {
  fixtures: () => '/api/fixtures/snapshot',
  odds: (fixtureId) => `/api/odds/snapshot/${fixtureId}`,
  scores: (fixtureId) => `/api/scores/snapshot/${fixtureId}`,
  scoresUpdates: (fixtureId) => `/api/scores/updates/${fixtureId}`,
};

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const out = { matchId: null, pollSeconds: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--match-id') out.matchId = args[++i];
    else if (args[i] === '--poll') out.pollSeconds = Number(args[++i]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Logging helpers - console + append-only JSONL file per data type per day.
// ---------------------------------------------------------------------------
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logEntry(kind, data) {
  const entry = { kind, fetched_at: new Date().toISOString(), data };
  console.log(`\n[${entry.fetched_at}] ${kind.toUpperCase()}`);
  console.log(JSON.stringify(data, null, 2));

  const day = entry.fetched_at.slice(0, 10); // YYYY-MM-DD
  const file = path.join(LOG_DIR, `txline-${kind}-${day}.jsonl`);
  fs.appendFileSync(file, JSON.stringify(entry) + '\n');
}

function logError(kind, err) {
  const entry = { kind, fetched_at: new Date().toISOString(), error: err.message };
  console.error(`\n[${entry.fetched_at}] ${kind.toUpperCase()} FAILED: ${err.message}`);
  const file = path.join(LOG_DIR, `txline-errors.jsonl`);
  fs.appendFileSync(file, JSON.stringify(entry) + '\n');
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------
async function fetchFixtures() {
  const data = await txlineRequest(ENDPOINTS.fixtures());
  logEntry('fixtures', data);
  return data;
}

async function fetchOdds(matchId) {
  const data = await txlineRequest(ENDPOINTS.odds(matchId));
  logEntry('odds', data);
  return data;
}

async function fetchScores(matchId) {
  const data = await txlineRequest(ENDPOINTS.scores(matchId));
  logEntry('scores', data);
  return data;
}

async function fetchProofs(fixtureId, scoresData) {
  // Validation proofs require a real seq from the scores response
  // If no scores data or no seq available, skip with a message
  if (!scoresData) {
    console.log('(No scores data available, skipping validation proofs)');
    return null;
  }

  // Try to extract a seq from the scores response
  const list = Array.isArray(scoresData) ? scoresData : scoresData?.scores || scoresData?.data || [];
  const firstScore = list[0];
  const seq = firstScore?.seq || firstScore?.Seq || firstScore?.sequence;

  if (!seq) {
    console.log('(No seq found in scores response, skipping validation proofs - match may not have started)');
    return null;
  }

  try {
    const endpoint = `/api/scores/stat-validation?fixtureId=${fixtureId}&seq=${seq}&statKey=1002`;
    const data = await txlineRequest(endpoint);
    logEntry('proofs', data);
    return data;
  } catch (err) {
    logError('proofs', err);
    return null;
  }
}

/** Best-effort extraction of a usable fixture id from a fixtures response.
 *  TxLINE uses 'FixtureId' as the field name (confirmed from docs). */
function pickMatchId(fixturesResponse) {
  const list = Array.isArray(fixturesResponse)
    ? fixturesResponse
    : fixturesResponse?.fixtures || fixturesResponse?.data || [];
  const first = list[0];
  if (!first) return null;
  return first.FixtureId || first.fixtureId || first.match_id || first.id || null;
}

async function fetchAllOnce(explicitMatchId) {
  let matchId = explicitMatchId;
  let scoresData = null;

  try {
    const fixtures = await fetchFixtures();
    if (!matchId) {
      matchId = pickMatchId(fixtures);
      if (matchId) console.log(`\n(No --match-id given, using first fixture: ${matchId})`);
    }
  } catch (err) {
    logError('fixtures', err);
  }

  if (!matchId) {
    console.warn(
      '\nNo match id available (pass --match-id, or the fixtures response shape ' +
        "didn't match what pickMatchId() expects - check logs/txline-fixtures-*.jsonl " +
        'and adjust pickMatchId if needed). Skipping odds/scores/proofs this round.'
    );
    return;
  }

  // Fetch odds
  try {
    await fetchOdds(matchId);
  } catch (err) {
    logError('odds', err);
  }

  // Fetch scores and use the data for proofs
  try {
    scoresData = await fetchScores(matchId);
  } catch (err) {
    logError('scores', err);
  }

  // Fetch proofs using scores data
  try {
    await fetchProofs(matchId, scoresData);
  } catch (err) {
    logError('proofs', err);
  }

  return matchId;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!isConfigured) {
    console.error(
      'TxLINE is not configured yet.\n' +
        'Run `npm run activate:txline` first to subscribe on-chain and activate ' +
        'API access, then re-run this script.'
    );
    process.exit(1);
  }

  ensureLogDir();
  const { matchId: explicitMatchId, pollSeconds } = parseArgs();

  console.log(`Logging TxLINE data to ${LOG_DIR}`);

  if (!pollSeconds) {
    await fetchAllOnce(explicitMatchId);
    return;
  }

  console.log(`Polling every ${pollSeconds}s. Ctrl+C to stop.`);
  let matchId = explicitMatchId;
  // Refetch fixtures + resolve matchId once, then poll odds/scores/proofs.
  matchId = (await fetchAllOnce(matchId)) || matchId;

  setInterval(async () => {
    if (!matchId) return;
    let scoresData = null;

    // Fetch odds
    try {
      await fetchOdds(matchId);
    } catch (err) {
      logError('odds', err);
    }

    // Fetch scores and use the data for proofs
    try {
      scoresData = await fetchScores(matchId);
    } catch (err) {
      logError('scores', err);
    }

    // Fetch proofs using scores data
    try {
      await fetchProofs(matchId, scoresData);
    } catch (err) {
      logError('proofs', err);
    }
  }, pollSeconds * 1000);
}

main().catch((err) => {
  console.error('[logTxlineData] Fatal error:', err.message || err);
  process.exit(1);
});
