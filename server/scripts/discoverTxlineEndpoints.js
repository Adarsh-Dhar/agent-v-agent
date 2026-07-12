#!/usr/bin/env node
/**
 * scripts/discoverTxlineEndpoints.js
 *
 * Diagnostic tool: probes a curated list of plausible paths for each of the
 * four TxLINE data groups (Fixtures, Odds, Scores, Validation Proofs) using
 * your ALREADY-ACTIVATED credentials, and prints the real status code +
 * response body for each. This exists because the paths baked into
 * logTxlineData.js were educated guesses (the live API Reference page
 * wasn't fetchable to verify them), and your logs/txline-errors.jsonl shows
 * they're wrong (403 on fixtures, 404 on odds/scores/proofs).
 *
 * The real API's own error bodies are a much better source of truth than
 * more guessing - a 403 body often explains *why* (e.g. "league not in your
 * subscription"), and a 404 vs a routed-but-wrong-method response tells you
 * whether a path exists at all.
 *
 * Usage:
 *   node scripts/discoverTxlineEndpoints.js
 *   node scripts/discoverTxlineEndpoints.js --match-id 12345
 *
 * Prerequisite: same as logTxlineData.js - run `npm run activate:txline` 
 * first (or otherwise have TXLINE_API_TOKEN populated in .env).
 *
 * Once you find the working paths, update the ENDPOINTS block in
 * scripts/logTxlineData.js to match and delete this file - it's a
 * throwaway diagnostic, not something to keep running long-term.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isConfigured, txlineRequest } from '../src/lib/txline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'logs', 'endpoint-discovery.json');

function parseArgs() {
  const args = process.argv.slice(2);
  let matchId = '1'; // harmless placeholder; we're probing routes, not real data
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--match-id') matchId = args[++i];
  }
  return { matchId };
}

function buildCandidates(matchId) {
  return {
    fixtures: [
      '/api/fixtures',
      '/api/fixtures?competition=world-cup-2026',
      '/api/fixtures?league=worldcup',
      '/api/v1/fixtures',
      '/fixtures',
    ],
    odds: [
      `/api/matches/${matchId}/odds/live`,
      `/api/matches/${matchId}/odds`,
      `/api/odds/${matchId}`,
      `/api/odds/live?fixtureId=${matchId}`,
      `/api/v1/matches/${matchId}/odds/live`,
      `/api/fixtures/${matchId}/odds`,
    ],
    scores: [
      `/api/matches/${matchId}/scores/live`,
      `/api/matches/${matchId}/scores`,
      `/api/scores/${matchId}`,
      `/api/scores/live?fixtureId=${matchId}`,
      `/api/v1/matches/${matchId}/scores/live`,
      `/api/fixtures/${matchId}/scores`,
    ],
    proofs: [
      `/api/matches/${matchId}/proofs`,
      `/api/proofs/${matchId}`,
      `/api/validation/proofs/${matchId}`,
      `/api/fixtures/${matchId}/proofs`,
      `/api/v1/matches/${matchId}/proofs`,
    ],
  };
}

async function probe(pathname) {
  try {
    const data = await txlineRequest(pathname);
    return { path: pathname, status: 200, ok: true, body: data };
  } catch (err) {
    const status = err.response?.status ?? null;
    const body = err.response?.data ?? err.message;
    return { path: pathname, status, ok: false, body };
  }
}

function summarize(label, result) {
  const marker = result.ok ? '✅' : result.status === 403 ? '⚠️ ' : '❌';
  console.log(`${marker} [${label}] ${result.status ?? 'ERR'}  ${result.path}`);
  if (result.body && typeof result.body === 'object') {
    console.log('   ' + JSON.stringify(result.body).slice(0, 300));
  } else if (result.body) {
    console.log('   ' + String(result.body).slice(0, 300));
  }
}

async function main() {
  if (!isConfigured) {
    console.error(
      'TxLINE is not configured. Run `npm run activate:txline` first, then re-run this.'
    );
    process.exit(1);
  }

  const { matchId } = parseArgs();
  console.log(`Probing TxLINE endpoints with placeholder match id "${matchId}"...\n`);

  const candidates = buildCandidates(matchId);
  const report = {};

  for (const [label, paths] of Object.entries(candidates)) {
    report[label] = [];
    for (const p of paths) {
      const result = await probe(p);
      summarize(label, result);
      report[label].push(result);
    }
    console.log('');
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`Full report written to ${REPORT_PATH}`);
  console.log(
    '\nLook for any ✅ (200) - that is your real path. For ⚠️ (403) entries, read the ' +
      'body: it usually says *why* (e.g. league/scope not in your subscription) rather ' +
      "than just being a wrong path. Once you've confirmed the real paths, update the " +
      'ENDPOINTS block in scripts/logTxlineData.js to match.'
  );
}

main().catch((err) => {
  console.error('[discoverTxlineEndpoints] Fatal error:', err.message || err);
  process.exit(1);
});
