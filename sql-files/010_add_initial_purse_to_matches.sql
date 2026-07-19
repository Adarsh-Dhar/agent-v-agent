-- Add initial_purse column to matches table
-- This stores the initial purse amount for the match, used when players join
-- Previously this was only stored on the first player's row, which was fragile

ALTER TABLE matches 
ADD COLUMN IF NOT EXISTS initial_purse NUMERIC(10, 2) DEFAULT 1.0;

-- Add index on initial_purse for common queries
CREATE INDEX IF NOT EXISTS idx_matches_initial_purse ON matches(initial_purse);

-- Backfill existing matches: set initial_purse from the first player's initial_purse
UPDATE matches 
SET initial_purse = (
  SELECT initial_purse 
  FROM match_players 
  WHERE match_players.match_id = matches.id 
  ORDER BY created_at ASC 
  LIMIT 1
)
WHERE initial_purse IS NULL OR initial_purse = 1.0;

-- Add comment to document the column
COMMENT ON COLUMN matches.initial_purse IS 'Initial purse amount for all players in this match (in SOL)';
