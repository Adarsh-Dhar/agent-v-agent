import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://tzcnntxptekcaapbibee.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6Y25udHhwdGVrY2FhcGJpYmVlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCOiMTc4Mzg3Mjg3MSwiZXhwIjoyMDk5NDQ4ODcxfQ.4pNGDAJ2YEQ2c3sHjeMBXLmG7txJjLHN166gIxpF1VY';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function applyMigration() {
  console.log('Applying replay support migration via direct SQL...');
  
  // Use the REST API to execute SQL
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      sql: `
        ALTER TABLE public.matches 
        ADD COLUMN IF NOT EXISTS is_replay BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS fixture_id TEXT,
        ADD COLUMN IF NOT EXISTS agent_match_id TEXT;
        
        CREATE INDEX IF NOT EXISTS matches_fixture_id_idx ON public.matches(fixture_id) WHERE is_replay = true;
      `
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error('Error applying migration:', error);
    console.log('\nPlease run this SQL manually in your Supabase dashboard:');
    console.log(`
ALTER TABLE public.matches 
ADD COLUMN IF NOT EXISTS is_replay BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS fixture_id TEXT,
ADD COLUMN IF NOT EXISTS agent_match_id TEXT;

CREATE INDEX IF NOT EXISTS matches_fixture_id_idx ON public.matches(fixture_id) WHERE is_replay = true;
    `);
    process.exit(1);
  }
  
  console.log('Migration applied successfully!');
  
  // Now update the match
  console.log('Updating match to replay mode...');
  const { error: updateError } = await supabase
    .from('matches')
    .update({
      is_replay: true,
      fixture_id: '18222446',
      agent_match_id: 'replay-18222446'
    })
    .eq('code', '7E5VJGNWB3P');
  
  if (updateError) {
    console.error('Error updating match:', updateError);
    console.log('\nPlease run this SQL manually:');
    console.log(`
UPDATE public.matches 
SET 
  is_replay = true,
  fixture_id = '18222446',
  agent_match_id = 'replay-18222446'
WHERE code = '7E5VJGNWB3P';
    `);
    process.exit(1);
  }
  
  console.log('Match updated successfully!');
  console.log('Your match is now in replay mode.');
}

applyMigration().catch(console.error);
