import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env and fill it in.'
  );
}

// Service-role key is used because this is a trusted backend process
// writing agent state, not a user-facing browser client.
// db: { schema: 'public' } ensures we use the public schema explicitly
export const supabase = createClient(url, key, {
  auth: { persistSession: false },
  db: { schema: 'public' },
});
