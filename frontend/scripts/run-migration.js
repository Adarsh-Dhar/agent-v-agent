const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing Supabase credentials in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

async function runMigration() {
  try {
    console.log('Adding secret_code column to matches table...')
    
    // Try direct SQL execution via Supabase
    const { data, error } = await supabase
      .from('matches')
      .select('secret_code')
      .limit(1)
    
    if (error && error.message.includes('column "secret_code" does not exist')) {
      console.log('Column does not exist, attempting to add it...')
      
      // Use the SQL editor approach via REST API
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`
        },
        body: JSON.stringify({
          sql: `ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS secret_code TEXT UNIQUE NOT NULL DEFAULT '';`
        })
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('Failed to add column via RPC:', errorText)
        
        console.log('\nPlease run this SQL manually in your Supabase SQL Editor:')
        console.log('ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS secret_code TEXT UNIQUE NOT NULL DEFAULT \'\';')
        console.log('CREATE INDEX IF NOT EXISTS matches_secret_code_idx ON public.matches(secret_code);')
        process.exit(1)
      }
      
      console.log('Column added successfully!')
      
      // Create index
      const indexResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`
        },
        body: JSON.stringify({
          sql: `CREATE INDEX IF NOT EXISTS matches_secret_code_idx ON public.matches(secret_code);`
        })
      })
      
      if (indexResponse.ok) {
        console.log('Index created successfully!')
      }
    } else if (error) {
      console.error('Error checking column:', error)
      process.exit(1)
    } else {
      console.log('Column already exists!')
    }

    console.log('Migration completed successfully!')
  } catch (err) {
    console.error('Migration error:', err)
    console.log('\nPlease run this SQL manually in your Supabase SQL Editor:')
    console.log('ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS secret_code TEXT UNIQUE NOT NULL DEFAULT \'\';')
    console.log('CREATE INDEX IF NOT EXISTS matches_secret_code_idx ON public.matches(secret_code);')
    process.exit(1)
  }
}

runMigration()
