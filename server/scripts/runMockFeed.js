#!/usr/bin/env node
import dotenv from 'dotenv';
import { createMockArgentinaSwitzerlandFeed } from '../src/lib/mockTxlineFeed.js';

dotenv.config();

// Fast simulation: 1 match minute = 1 real second
// Total match is ~121 minutes (45 first half + 15 half time + 45 second half + 30 extra time + penalties)
const durationMs = 121 * 1000;
const tick = createMockArgentinaSwitzerlandFeed({ durationMs });

console.log('Starting Argentina vs Switzerland mock feed simulation...');
console.log(`Duration: ${durationMs / 1000} seconds real time (1 match minute = 1 second)`);
console.log('Press Ctrl+C to stop\n');

const interval = setInterval(async () => {
  const snapshot = await tick();
  console.log(`[${snapshot.minute}'] odds=${snapshot.odds.toFixed(3)} score=${snapshot.score.home}-${snapshot.score.away} event=${snapshot.event || '-'} period=${snapshot.period}`);

  if (snapshot.matchEnded) {
    console.log('\nMatch ended! Simulation complete.');
    clearInterval(interval);
  }
}, 1000);
