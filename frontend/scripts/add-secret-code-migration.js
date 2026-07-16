const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

async function runMigration() {
  try {
    console.log('Adding secret_code column to matches table...')
    
    const { error } = await supabase.rpc('exec_sql', {
      sql: `
        ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS secret_code TEXT UNIQUE NOT NULL DEFAULT '';
        CREATE INDEX IF NOT EXISTS matches_secret_code_idx ON public.matches(secret_code);
      `
    })

    if (error) {
      console.error('Migration failed:', error)
      process.exit(1)
    }

    console.log('Migration completed successfully!')
  } catch (err) {
    console.error('Migration error:', err)
    process.exit(1)
  }
}

runMigration()
