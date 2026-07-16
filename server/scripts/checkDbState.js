import { supabase } from '../src/lib/supabaseClient.js';

async function checkDbState() {
  console.log('Checking database state...\n');

  // Check existing agents with new columns
  const { data: agents, error } = await supabase
    .from('agents')
    .select('id, name, market_focus, decision_style, wildcard_trait, phase_weighting, odds_lookback_ticks, odds_threshold_pct, volatility_window, breakout_zscore')
    .limit(5);

  if (error) {
    console.error('Error fetching agents:', error);
  } else {
    console.log('Sample agents:');
    if (agents.length === 0) {
      console.log('No agents found in database');
    } else {
      agents.forEach(agent => {
        console.log(`- ${agent.name}:`);
        console.log(`  market_focus: ${agent.market_focus}`);
        console.log(`  decision_style: ${agent.decision_style}`);
        console.log(`  wildcard_trait: ${agent.wildcard_trait}`);
        console.log(`  phase_weighting: ${agent.phase_weighting}`);
        console.log(`  odds_lookback_ticks: ${agent.odds_lookback_ticks}`);
        console.log(`  odds_threshold_pct: ${agent.odds_threshold_pct}`);
        console.log(`  volatility_window: ${agent.volatility_window}`);
        console.log(`  breakout_zscore: ${agent.breakout_zscore}`);
      });
    }
  }

  // Check table structure
  console.log('\nTo check table structure, run this in Supabase SQL editor:');
  console.log(`
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'agents'
AND table_schema = 'public'
ORDER BY ordinal_position;
  `);
}

checkDbState();
