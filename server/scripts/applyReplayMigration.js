import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://tzcnntxptekcaapbibee.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6Y25udHhwdGVrY2FhcGJpYmVlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mzg3Mjg3MSwiZXhwIjoyMDk5NDQ4ODcxfQ.4pNGDAJ2YEQ2c3sHjeMBXLmG7txJjLHN166gIxpF1VY';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function applyMigration() {
  console.log('Applying replay support migration...');
  
  // Add columns to matches table
  const { error: addColumnsError } = await supabase.rpc('exec_sql', {
    sql: `
      ALTER TABLE public.matches 
      ADD COLUMN IF NOT EXISTS is_replay BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS fixture_id TEXT,
      ADD COLUMN IF NOT EXISTS agent_match_id TEXT;
      
      CREATE INDEX IF NOT EXISTS matches_fixture_id_idx ON public.matches(fixture_id) WHERE is_replay = true;
    `
  });
  
  if (addColumnsError) {
    console.error('Error adding columns:', addColumnsError);
    console.log('Trying direct SQL execution...');
    
    // Try using the SQL editor approach
    const { error: directError } = await supabase
      .from('matches')
      .select('id')
      .limit(1);
    
    if (directError) {
      console.error('Error accessing matches table:', directError);
      process.exit(1);
    }
    
    console.log('Table exists, columns may need to be added via Supabase dashboard');
    console.log('Please run this SQL in your Supabase SQL editor:');
    console.log(`
ALTER TABLE public.matches 
ADD COLUMN IF NOT EXISTS is_replay BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS fixture_id TEXT,
ADD COLUMN IF NOT EXISTS agent_match_id TEXT;

CREATE INDEX IF NOT EXISTS matches_fixture_id_idx ON public.matches(fixture_id) WHERE is_replay = true;
    `);
  } else {
    console.log('Migration applied successfully');
  }
}

applyMigration().catch(console.error);
