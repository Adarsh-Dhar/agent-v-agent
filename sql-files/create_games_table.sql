-- Create games table for real-life events that matches are linked to
CREATE TABLE IF NOT EXISTS public.games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  sport TEXT NOT NULL, -- e.g., 'football', 'cricket', 'basketball'
  team_a TEXT NOT NULL,
  team_b TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming', -- 'upcoming', 'ongoing', 'completed'
  start_time TIMESTAMP WITH TIME ZONE,
  end_time TIMESTAMP WITH TIME ZONE,
  location TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add game_id to matches table if it doesn't exist
ALTER TABLE public.matches
ADD COLUMN IF NOT EXISTS game_id UUID REFERENCES public.games(id) ON DELETE SET NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS games_status_idx ON public.games(status);
CREATE INDEX IF NOT EXISTS matches_game_id_idx ON public.matches(game_id);

-- Insert initial games (ongoing)
INSERT INTO public.games (name, description, sport, team_a, team_b, status, start_time) VALUES
('Argentina vs Switzerland', 'International Football Match', 'football', 'Argentina', 'Switzerland', 'ongoing', NOW()),
('India vs Pakistan', 'Cricket Test Match', 'cricket', 'India', 'Pakistan', 'ongoing', NOW()),
('Los Angeles Lakers vs Golden State Warriors', 'NBA Regular Season', 'basketball', 'Los Angeles Lakers', 'Golden State Warriors', 'ongoing', NOW()),
('England vs Australia', 'Rugby World Cup', 'rugby', 'England', 'Australia', 'upcoming', NOW() + INTERVAL '2 days'),
('France vs New Zealand', 'Rugby Union Test', 'rugby', 'France', 'New Zealand', 'upcoming', NOW() + INTERVAL '3 days')
ON CONFLICT DO NOTHING;
