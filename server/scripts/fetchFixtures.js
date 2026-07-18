#!/usr/bin/env node
/**
 * scripts/fetchFixtures.js
 *
 * Fetches all available fixtures from TxLINE API using the correct endpoint.
 * Usage: node scripts/fetchFixtures.js
 */

import 'dotenv/config';
import { txlineRequest } from '../src/lib/txline.js';

async function main() {
  try {
    console.log('Fetching fixtures from TxLINE API...');
    
    // Use the correct endpoint for fixtures snapshot
    const fixtures = await txlineRequest('/api/fixtures/snapshot');
    
    console.log(`Successfully fetched ${Array.isArray(fixtures) ? fixtures.length : 'unknown number of'} fixtures`);
    
    if (Array.isArray(fixtures) && fixtures.length > 0) {
      console.log('\nSample fixture data:');
      console.log(JSON.stringify(fixtures[0], null, 2));
      
      console.log('\nAll fixture IDs:');
      fixtures.forEach(f => {
        console.log(`- ${f.FixtureId || f.id || f.fixture_id}: ${f.Participant1 || f.home_team} vs ${f.Participant2 || f.away_team} (${f.Competition})`);
      });
    }
    
    return fixtures;
  } catch (error) {
    console.error('Error fetching fixtures:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    process.exit(1);
  }
}

main();
