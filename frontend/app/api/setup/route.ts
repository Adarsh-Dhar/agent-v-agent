import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return NextResponse.json(
        { error: 'Missing Supabase credentials' },
        { status: 400 }
      )
    }

    const sql = `
      CREATE TABLE IF NOT EXISTS public.agents (
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
      );

      CREATE INDEX IF NOT EXISTS agents_created_at_idx ON public.agents(created_at DESC);
      CREATE INDEX IF NOT EXISTS agents_status_idx ON public.agents(status);

      CREATE TABLE IF NOT EXISTS public.games (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        description TEXT,
        sport TEXT NOT NULL,
        team_a TEXT NOT NULL,
        team_b TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'upcoming',
        start_time TIMESTAMP WITH TIME ZONE,
        end_time TIMESTAMP WITH TIME ZONE,
        location TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.players (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        bio TEXT,
        avatar_url TEXT,
        total_trades INTEGER DEFAULT 0,
        total_pnl NUMERIC DEFAULT 0,
        win_rate NUMERIC DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.matches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        creator_id UUID NOT NULL REFERENCES public.players(user_id) ON DELETE CASCADE,
        game_id UUID REFERENCES public.games(id) ON DELETE SET NULL,
        initial_purse NUMERIC DEFAULT 1000,
        status TEXT DEFAULT 'pending',
        max_players INTEGER DEFAULT 4,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.match_players (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES public.players(user_id) ON DELETE CASCADE,
        agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
        agent_name TEXT,
        purse NUMERIC DEFAULT 1000,
        initial_purse NUMERIC DEFAULT 1000,
        pnl NUMERIC DEFAULT 0,
        joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS players_user_id_idx ON public.players(user_id);
      CREATE INDEX IF NOT EXISTS games_status_idx ON public.games(status);
      CREATE INDEX IF NOT EXISTS matches_code_idx ON public.matches(code);
      CREATE INDEX IF NOT EXISTS matches_status_idx ON public.matches(status);
      CREATE INDEX IF NOT EXISTS matches_creator_idx ON public.matches(creator_id);
      CREATE INDEX IF NOT EXISTS matches_game_id_idx ON public.matches(game_id);
      CREATE INDEX IF NOT EXISTS match_players_match_id_idx ON public.match_players(match_id);
      CREATE INDEX IF NOT EXISTS match_players_user_id_idx ON public.match_players(user_id);
    `

    // Use Supabase REST API to execute SQL
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/query_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseServiceRoleKey,
        'Authorization': `Bearer ${supabaseServiceRoleKey}`,
      },
      body: JSON.stringify({ sql }),
    }).catch(err => {
      console.log('[v0] REST API attempt failed:', err.message)
      return null
    })

    if (!response) {
      // Fallback: provide instructions for manual setup
      return NextResponse.json(
        {
          message: 'Please create the table manually',
          sql: `
            CREATE TABLE IF NOT EXISTS public.agents (
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
            );

            CREATE INDEX IF NOT EXISTS agents_created_at_idx ON public.agents(created_at DESC);
            CREATE INDEX IF NOT EXISTS agents_status_idx ON public.agents(status);

            CREATE TABLE IF NOT EXISTS public.games (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              name TEXT NOT NULL,
              description TEXT,
              sport TEXT NOT NULL,
              team_a TEXT NOT NULL,
              team_b TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'upcoming',
              start_time TIMESTAMP WITH TIME ZONE,
              end_time TIMESTAMP WITH TIME ZONE,
              location TEXT,
              created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
              updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS public.players (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
              email TEXT NOT NULL UNIQUE,
              name TEXT NOT NULL,
              bio TEXT,
              avatar_url TEXT,
              total_trades INTEGER DEFAULT 0,
              total_pnl NUMERIC DEFAULT 0,
              win_rate NUMERIC DEFAULT 0,
              created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
              updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS public.matches (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              code TEXT UNIQUE NOT NULL,
              title TEXT NOT NULL,
              description TEXT,
              creator_id UUID NOT NULL REFERENCES public.players(user_id) ON DELETE CASCADE,
              game_id UUID REFERENCES public.games(id) ON DELETE SET NULL,
              initial_purse NUMERIC DEFAULT 1000,
              status TEXT DEFAULT 'pending',
              max_players INTEGER DEFAULT 4,
              created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
              updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS public.match_players (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
              user_id UUID NOT NULL REFERENCES public.players(user_id) ON DELETE CASCADE,
              agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
              agent_name TEXT,
              purse NUMERIC DEFAULT 1000,
              initial_purse NUMERIC DEFAULT 1000,
              pnl NUMERIC DEFAULT 0,
              joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
              updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS players_user_id_idx ON public.players(user_id);
            CREATE INDEX IF NOT EXISTS games_status_idx ON public.games(status);
            CREATE INDEX IF NOT EXISTS matches_code_idx ON public.matches(code);
            CREATE INDEX IF NOT EXISTS matches_status_idx ON public.matches(status);
            CREATE INDEX IF NOT EXISTS matches_creator_idx ON public.matches(creator_id);
            CREATE INDEX IF NOT EXISTS matches_game_id_idx ON public.matches(game_id);
            CREATE INDEX IF NOT EXISTS match_players_match_id_idx ON public.match_players(match_id);
            CREATE INDEX IF NOT EXISTS match_players_user_id_idx ON public.match_players(user_id);
          `,
          instructions: [
            '1. Go to https://app.supabase.com/projects',
            '2. Select your project (tzcnntxptekcaapbibee)',
            '3. Click SQL Editor',
            '4. Click New Query',
            '5. Paste the SQL above and run it',
          ],
        },
        { status: 200 }
      )
    }

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'Failed to create table')
    }

    return NextResponse.json(
      { message: 'Database setup completed successfully' },
      { status: 200 }
    )
  } catch (error) {
    console.error('[v0] Setup error:', error)
    return NextResponse.json(
      { error: 'Setup encountered an issue', details: String(error) },
      { status: 500 }
    )
  }
}
