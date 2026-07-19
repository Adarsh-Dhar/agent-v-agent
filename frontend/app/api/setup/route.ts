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

      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS owner TEXT;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS market_focus TEXT DEFAULT '1x2';
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS ah_line_band NUMERIC;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS ou_line_band NUMERIC;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS decision_style TEXT DEFAULT 'volatility_breakout';
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS odds_lookback_ticks INTEGER DEFAULT 3;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS odds_threshold_pct NUMERIC DEFAULT 2;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS volatility_window INTEGER DEFAULT 6;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS breakout_zscore NUMERIC DEFAULT 1.5;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS confirmation_tolerance TEXT DEFAULT 'adaptive';
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS score_state_mode TEXT DEFAULT 'momentum_only';
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS side_bias TEXT DEFAULT 'none';
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS risk_profile TEXT DEFAULT 'flat_stake';
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS reaction_latency_ms INTEGER DEFAULT 3000;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS context_venue_aware BOOLEAN DEFAULT false;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS context_weather_aware BOOLEAN DEFAULT false;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS context_competition_tier_aware BOOLEAN DEFAULT false;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS wildcard_trait TEXT DEFAULT 'none';
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS position_sizing TEXT DEFAULT 'percent_of_budget';
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS fixed_stake NUMERIC DEFAULT 0.05;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS percentage_stake NUMERIC DEFAULT 10;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS confidence_weighted BOOLEAN DEFAULT false;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS exit_rule TEXT DEFAULT 'stop_loss_take_profit';
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS stop_loss NUMERIC DEFAULT 5;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS take_profit NUMERIC DEFAULT 15;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS time_based_exit_time INTEGER;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS aggression TEXT DEFAULT 'instant';
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS cooldown_minutes INTEGER DEFAULT 2;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS confirmation_threshold INTEGER DEFAULT 2;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS direction_bias TEXT DEFAULT 'bidirectional';
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS phase_weighting TEXT DEFAULT 'full_match';
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS max_reentries INTEGER DEFAULT 5;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS adaptivity_mode TEXT DEFAULT 'static';
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS llm_reflection_enabled BOOLEAN DEFAULT false;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS last_reflection_timestamp TIMESTAMPTZ;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS max_exposure_pct NUMERIC;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS max_drawdown_stop_pct NUMERIC;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS match_id TEXT;

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
        secret_code TEXT,
        title TEXT NOT NULL,
        description TEXT,
        creator_id TEXT NOT NULL,
        creator_name TEXT,
        game_id UUID REFERENCES public.games(id) ON DELETE SET NULL,
        initial_purse NUMERIC DEFAULT 0.001,
        status TEXT DEFAULT 'pending',
        max_players INTEGER DEFAULT 4,
        agent_match_id TEXT,
        is_replay BOOLEAN DEFAULT false,
        fixture_id TEXT,
        home_team TEXT,
        away_team TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS secret_code TEXT;
      ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS creator_name TEXT;
      ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS agent_match_id TEXT;
      ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS is_replay BOOLEAN DEFAULT false;
      ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS fixture_id TEXT;
      ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS home_team TEXT;
      ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS away_team TEXT;

      CREATE TABLE IF NOT EXISTS public.match_players (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
        player_id TEXT NOT NULL,
        player_name TEXT,
        agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
        agent_name TEXT,
        purse NUMERIC DEFAULT 0.001,
        initial_purse NUMERIC DEFAULT 0.001,
        pnl NUMERIC DEFAULT 0,
        joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      ALTER TABLE public.match_players ADD COLUMN IF NOT EXISTS player_id TEXT;
      ALTER TABLE public.match_players ADD COLUMN IF NOT EXISTS player_name TEXT;

      CREATE INDEX IF NOT EXISTS players_user_id_idx ON public.players(user_id);
      CREATE INDEX IF NOT EXISTS games_status_idx ON public.games(status);
      CREATE INDEX IF NOT EXISTS matches_code_idx ON public.matches(code);
      CREATE INDEX IF NOT EXISTS matches_status_idx ON public.matches(status);
      CREATE INDEX IF NOT EXISTS matches_creator_idx ON public.matches(creator_id);
      CREATE INDEX IF NOT EXISTS matches_game_id_idx ON public.matches(game_id);
      CREATE INDEX IF NOT EXISTS match_players_match_id_idx ON public.match_players(match_id);
      CREATE INDEX IF NOT EXISTS match_players_user_id_idx ON public.match_players(user_id);

      CREATE TABLE IF NOT EXISTS public.agent_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
        match_id TEXT NOT NULL,
        budget_cap NUMERIC NOT NULL DEFAULT 0.001,
        balance NUMERIC DEFAULT 0,
        realized_pnl NUMERIC DEFAULT 0,
        unrealized_pnl NUMERIC DEFAULT 0,
        trade_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        wallet_pubkey TEXT,
        wallet_secret_key INTEGER[],
        pid INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS agent_runs_match_idx ON public.agent_runs(match_id);
      CREATE INDEX IF NOT EXISTS agent_runs_agent_idx ON public.agent_runs(agent_id);

      ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS wallet_pubkey TEXT;
      ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS wallet_secret_key INTEGER[];
      ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS pid INTEGER;

      CREATE TABLE IF NOT EXISTS public.trades (
        id BIGSERIAL PRIMARY KEY,
        agent_id UUID NOT NULL,
        run_id UUID,
        match_id TEXT NOT NULL,
        side TEXT NOT NULL,
        odds NUMERIC,
        stake NUMERIC,
        reason TEXT,
        pnl NUMERIC,
        balance_after NUMERIC,
        tx_signature TEXT,
        match_minute INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS trades_run_idx ON public.trades(run_id);
      CREATE INDEX IF NOT EXISTS trades_match_idx ON public.trades(match_id);

      CREATE TABLE IF NOT EXISTS public.match_ticks (
        match_id TEXT NOT NULL,
        minute INTEGER NOT NULL,
        odds NUMERIC,
        score_home INTEGER,
        score_away INTEGER,
        event TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (match_id, minute)
      );

      CREATE INDEX IF NOT EXISTS match_ticks_match_id_idx ON public.match_ticks(match_id);

      CREATE TABLE IF NOT EXISTS public.match_clocks (
        match_id TEXT PRIMARY KEY,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
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
              secret_code TEXT,
              title TEXT NOT NULL,
              description TEXT,
              creator_id TEXT NOT NULL,
              creator_name TEXT,
              game_id UUID REFERENCES public.games(id) ON DELETE SET NULL,
              initial_purse NUMERIC DEFAULT 0.001,
              status TEXT DEFAULT 'pending',
              max_players INTEGER DEFAULT 4,
              agent_match_id TEXT,
              is_replay BOOLEAN DEFAULT false,
              fixture_id TEXT,
              home_team TEXT,
              away_team TEXT,
              created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
              updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS secret_code TEXT;
            ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS creator_name TEXT;
            ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS agent_match_id TEXT;
            ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS is_replay BOOLEAN DEFAULT false;
            ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS fixture_id TEXT;
            ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS home_team TEXT;
            ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS away_team TEXT;

            CREATE TABLE IF NOT EXISTS public.match_players (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
              player_id TEXT NOT NULL,
              player_name TEXT,
              agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
              agent_name TEXT,
              purse NUMERIC DEFAULT 0.001,
              initial_purse NUMERIC DEFAULT 0.001,
              pnl NUMERIC DEFAULT 0,
              joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
              updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            ALTER TABLE public.match_players ADD COLUMN IF NOT EXISTS player_id TEXT;
            ALTER TABLE public.match_players ADD COLUMN IF NOT EXISTS player_name TEXT;

            CREATE INDEX IF NOT EXISTS players_user_id_idx ON public.players(user_id);
            CREATE INDEX IF NOT EXISTS games_status_idx ON public.games(status);
            CREATE INDEX IF NOT EXISTS matches_code_idx ON public.matches(code);
            CREATE INDEX IF NOT EXISTS matches_status_idx ON public.matches(status);
            CREATE INDEX IF NOT EXISTS matches_creator_idx ON public.matches(creator_id);
            CREATE INDEX IF NOT EXISTS matches_game_id_idx ON public.matches(game_id);
            CREATE INDEX IF NOT EXISTS match_players_match_id_idx ON public.match_players(match_id);
            CREATE INDEX IF NOT EXISTS match_players_user_id_idx ON public.match_players(user_id);

            CREATE TABLE IF NOT EXISTS public.agent_runs (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
              match_id TEXT NOT NULL,
              budget_cap NUMERIC NOT NULL DEFAULT 0.001,
              balance NUMERIC DEFAULT 0,
              realized_pnl NUMERIC DEFAULT 0,
              unrealized_pnl NUMERIC DEFAULT 0,
              trade_count INTEGER DEFAULT 0,
              status TEXT DEFAULT 'active',
              wallet_pubkey TEXT,
              wallet_secret_key INTEGER[],
              pid INTEGER,
              created_at TIMESTAMPTZ DEFAULT NOW(),
              updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS agent_runs_match_idx ON public.agent_runs(match_id);
            CREATE INDEX IF NOT EXISTS agent_runs_agent_idx ON public.agent_runs(agent_id);

            CREATE TABLE IF NOT EXISTS public.trades (
              id BIGSERIAL PRIMARY KEY,
              agent_id UUID NOT NULL,
              run_id UUID,
              match_id TEXT NOT NULL,
              side TEXT NOT NULL,
              odds NUMERIC,
              stake NUMERIC,
              reason TEXT,
              pnl NUMERIC,
              balance_after NUMERIC,
              tx_signature TEXT,
              match_minute INTEGER,
              created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS trades_run_idx ON public.trades(run_id);
            CREATE INDEX IF NOT EXISTS trades_match_idx ON public.trades(match_id);

            CREATE TABLE IF NOT EXISTS public.match_ticks (
              match_id TEXT NOT NULL,
              minute INTEGER NOT NULL,
              odds NUMERIC,
              score_home INTEGER,
              score_away INTEGER,
              event TEXT,
              created_at TIMESTAMPTZ DEFAULT NOW(),
              PRIMARY KEY (match_id, minute)
            );

            CREATE INDEX IF NOT EXISTS match_ticks_match_id_idx ON public.match_ticks(match_id);

            CREATE TABLE IF NOT EXISTS public.match_clocks (
              match_id TEXT PRIMARY KEY,
              started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              created_at TIMESTAMPTZ DEFAULT NOW()
            );
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
