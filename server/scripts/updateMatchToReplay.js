import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://tzcnntxptekcaapbibee.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6Y25udHhwdGVrY2FhcGJpYmVlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mzg3Mjg3MSwiZXhwIjoyMDk5NDQ4ODcxfQ.4pNGDAJ2YEQ2c3sHjeMBXLmG7txJjLHN166gIxpF1VY';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function updateMatchToReplay() {
  const matchCode = '7E5VJGNWB3P';
  
  console.log(`Updating match ${matchCode} to replay mode...`);
  
  // First, get the match to verify it exists
  const { data: match, error: fetchError } = await supabase
    .from('matches')
    .select('*')
    .eq('code', matchCode)
    .single();
  
  if (fetchError) {
    console.error('Error fetching match:', fetchError);
    process.exit(1);
  }
  
  console.log('Current match state:', match);
  
  // Update the match to be a replay match
  const { data: updatedMatch, error: updateError } = await supabase
    .from('matches')
    .update({
      is_replay: true,
      fixture_id: '18241006',
      agent_match_id: 'replay-18241006'
    })
    .eq('code', matchCode)
    .select()
    .single();
  
  if (updateError) {
    console.error('Error updating match:', updateError);
    process.exit(1);
  }
  
  console.log('Match updated successfully:', updatedMatch);
  console.log('Agent match_id is now:', updatedMatch.agent_match_id);
}

updateMatchToReplay().catch(console.error);
