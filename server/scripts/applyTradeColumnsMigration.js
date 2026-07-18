import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function applyMigration() {
  console.log('Applying trade columns migration via direct SQL...');
  
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
        ALTER TABLE public.trades
        ADD COLUMN IF NOT EXISTS pnl NUMERIC,
        ADD COLUMN IF NOT EXISTS balance_after NUMERIC;
      `
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error('Error applying migration:', error);
    console.log('\nPlease run this SQL manually in your Supabase dashboard:');
    console.log(`
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS pnl NUMERIC,
  ADD COLUMN IF NOT EXISTS balance_after NUMERIC;
    `);
    process.exit(1);
  }
  
  console.log('Migration applied successfully!');
}

applyMigration().catch(console.error);
