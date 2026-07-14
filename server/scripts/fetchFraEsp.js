#!/usr/bin/env node
/**
 * scripts/fetchFraEsp.js
 *
 * Fetches details for France vs Spain (FixtureId: 18237038) and stores them in fra-esp-logs.txt
 *
 * Usage:
 *   node scripts/fetchFraEsp.js              # one-shot fetch
 *   node scripts/fetchFraEsp.js --poll 30    # poll every 30 seconds
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isConfigured, txlineRequest } from '../src/lib/txline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOG_FILE = path.join(ROOT, 'fra-esp-logs.txt');

const FIXTURE_ID = '18237038';
const MATCH_NAME = 'France vs Spain';

// Parse CLI args
function parseArgs() {
  const args = process.argv.slice(2);
  const out = { pollSeconds: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--poll') out.pollSeconds = Number(args[++i]);
  }
  return out;
}

async function fetchData() {
  let output = `=== ${MATCH_NAME} (FixtureId: ${FIXTURE_ID}) ===\n`;
  output += `Fetched at: ${new Date().toISOString()}\n\n`;

  // Fetch fixtures
  try {
    console.log('Fetching fixtures...');
    const fixtures = await txlineRequest('/api/fixtures/snapshot');
    const fixture = fixtures.find(f => f.FixtureId === parseInt(FIXTURE_ID));
    
    if (fixture) {
      output += '--- FIXTURE DETAILS ---\n';
      output += JSON.stringify(fixture, null, 2);
      output += '\n\n';
      console.log('✓ Fixtures fetched');
    } else {
      output += '--- FIXTURE DETAILS ---\n';
      output += 'Fixture not found in fixtures list\n\n';
      console.log('✗ Fixture not found');
    }
  } catch (err) {
    output += `--- FIXTURE DETAILS ---\n`;
    output += `Error: ${err.message}\n\n`;
    console.log('✗ Fixtures failed:', err.message);
  }

  // Fetch odds
  try {
    console.log('Fetching odds...');
    const odds = await txlineRequest(`/api/odds/snapshot/${FIXTURE_ID}`);
    output += '--- ODDS ---\n';
    output += JSON.stringify(odds, null, 2);
    output += '\n\n';
    console.log('✓ Odds fetched');
  } catch (err) {
    output += `--- ODDS ---\n`;
    output += `Error: ${err.message}\n\n`;
    console.log('✗ Odds failed:', err.message);
  }

  // Fetch scores
  let scoresData = null;
  try {
    console.log('Fetching scores...');
    scoresData = await txlineRequest(`/api/scores/snapshot/${FIXTURE_ID}`);
    output += '--- SCORES ---\n';
    output += JSON.stringify(scoresData, null, 2);
    output += '\n\n';
    console.log('✓ Scores fetched');
  } catch (err) {
    output += `--- SCORES ---\n`;
    output += `Error: ${err.message}\n\n`;
    console.log('✗ Scores failed:', err.message);
  }

  // Fetch validation proofs
  try {
    console.log('Fetching validation proofs...');
    const list = Array.isArray(scoresData) ? scoresData : scoresData?.scores || scoresData?.data || [];
    const firstScore = list[0];
    const seq = firstScore?.seq || firstScore?.Seq || firstScore?.sequence;

    if (seq) {
      const proofs = await txlineRequest(`/api/scores/stat-validation?fixtureId=${FIXTURE_ID}&seq=${seq}&statKey=1002`);
      output += '--- VALIDATION PROOFS ---\n';
      output += JSON.stringify(proofs, null, 2);
      output += '\n\n';
      console.log('✓ Validation proofs fetched');
    } else {
      output += '--- VALIDATION PROOFS ---\n';
      output += 'No seq found in scores response (match may not have started)\n\n';
      console.log('✗ No seq found, skipping validation proofs');
    }
  } catch (err) {
    output += `--- VALIDATION PROOFS ---\n`;
    output += `Error: ${err.message}\n\n`;
    console.log('✗ Validation proofs failed:', err.message);
  }

  // Write to file
  fs.writeFileSync(LOG_FILE, output);
  console.log(`\n✓ Results saved to ${LOG_FILE}`);
}

async function main() {
  if (!isConfigured) {
    console.error(
      'TxLINE is not configured yet.\n' +
        'Run `npm run activate:txline` first to subscribe on-chain and activate ' +
        'API access, then re-run this script.'
    );
    process.exit(1);
  }

  const { pollSeconds } = parseArgs();
  console.log(`Fetching ${MATCH_NAME} (FixtureId: ${FIXTURE_ID})...`);

  if (!pollSeconds) {
    await fetchData();
    return;
  }

  console.log(`Polling every ${pollSeconds}s. Ctrl+C to stop.`);
  await fetchData();
  
  setInterval(async () => {
    console.log(`\n[${new Date().toISOString()}] Polling...`);
    await fetchData();
  }, pollSeconds * 1000);
}

main().catch((err) => {
  console.error('[fetchFraEsp] Fatal error:', err.message || err);
  process.exit(1);
});
