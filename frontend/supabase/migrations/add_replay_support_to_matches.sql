-- Add replay support columns to matches table
ALTER TABLE public.matches 
ADD COLUMN IF NOT EXISTS is_replay BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS fixture_id TEXT,
ADD COLUMN IF NOT EXISTS agent_match_id TEXT;

-- Create index for fixture_id to speed up replay match lookups
CREATE INDEX IF NOT EXISTS matches_fixture_id_idx ON public.matches(fixture_id) WHERE is_replay = true;
