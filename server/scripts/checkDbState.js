import { supabase } from '../src/lib/supabaseClient.js';

async function checkDbState() {
  console.log('Checking database state...\n');

  // Check existing agents
  const { data: agents, error } = await supabase
    .from('agents')
    .select('id, name, portfolio_behavior, target_selection')
    .limit(5);

  if (error) {
    console.error('Error fetching agents:', error);
  } else {
    console.log('Sample agents:');
    agents.forEach(agent => {
      console.log(`- ${agent.name}: portfolio_behavior=${agent.portfolio_behavior}, target_selection=${agent.target_selection}`);
    });
  }

  // Check table structure
  console.log('\nTo check constraints, run this in Supabase SQL editor:');
  console.log(`
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.agents'::regclass
AND conname LIKE '%portfolio%';
  `);
}

checkDbState();
