#!/usr/bin/env node
/**
 * scripts/resetClock.js
 *
 * Deletes the stale shared epoch for a replay match so the next agent run
 * elects a fresh start time. Without this, every re-test of the same
 * match_id instantly overflows to the last fixture entry because the old
 * epoch is already far past the fixture's wall-clock duration.
 *
 * Usage:
 *   node scripts/resetClock.js replay-18241006
 */

import { resetMatchEpoch } from '../src/lib/matchClock.js';

const matchId = process.argv[2];
if (!matchId) {
  console.error('Usage: node scripts/resetClock.js <match_id>');
  console.error('Example: node scripts/resetClock.js replay-18241006');
  process.exit(1);
}

try {
  await resetMatchEpoch(matchId);
  console.log(`Clock reset for ${matchId}. Start a new run immediately.`);
} catch (err) {
  console.error(`Failed to reset clock: ${err.message}`);
  process.exit(1);
}
