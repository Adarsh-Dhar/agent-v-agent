import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

async function setupDatabase() {
  try {
    console.log('Setting up Supabase database...')

    // Create agents table
    const { error: tableError } = await supabase.rpc('create_agents_table', {}, { 
      count: 'exact' 
    }).catch(() => ({ error: null }))

    // Alternative: Use SQL directly via admin API
    const { data, error } = await supabase.sql`
      CREATE TABLE IF NOT EXISTS agents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        description TEXT,
        signal_type TEXT NOT NULL DEFAULT 'odds-movement',
        odds_threshold NUMERIC DEFAULT 5,
        odds_timeframe INTEGER DEFAULT 5,
        position_sizing TEXT NOT NULL DEFAULT 'fixed',
        fixed_stake NUMERIC DEFAULT 100,
        percentage_stake NUMERIC DEFAULT 10,
        exit_rule TEXT NOT NULL DEFAULT 'stop-loss',
        stop_loss NUMERIC DEFAULT 5,
        take_profit NUMERIC DEFAULT 15,
        aggression TEXT NOT NULL DEFAULT 'instant',
        cooldown_minutes INTEGER DEFAULT 2,
        direction_bias TEXT NOT NULL DEFAULT 'bidirectional',
        budget_cap NUMERIC NOT NULL DEFAULT 5000,
        balance NUMERIC DEFAULT 0,
        realized_pnl NUMERIC DEFAULT 0,
        unrealized_pnl NUMERIC DEFAULT 0,
        trade_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `

    console.log('Database setup complete!')
  } catch (error) {
    console.error('Error setting up database:', error)
    process.exit(1)
  }
}

setupDatabase()
