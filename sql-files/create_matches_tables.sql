-- Create matches table
CREATE TABLE IF NOT EXISTS public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  creator_id TEXT NOT NULL,
  creator_name TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  max_players INTEGER DEFAULT 4,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create match_players table
CREATE TABLE IF NOT EXISTS public.match_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  agent_name TEXT,
  purse NUMERIC DEFAULT 1000,
  initial_purse NUMERIC DEFAULT 1000,
  pnl NUMERIC DEFAULT 0,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS matches_code_idx ON public.matches(code);
CREATE INDEX IF NOT EXISTS matches_status_idx ON public.matches(status);
CREATE INDEX IF NOT EXISTS matches_creator_idx ON public.matches(creator_id);
CREATE INDEX IF NOT EXISTS match_players_match_id_idx ON public.match_players(match_id);
CREATE INDEX IF NOT EXISTS match_players_player_id_idx ON public.match_players(player_id);
