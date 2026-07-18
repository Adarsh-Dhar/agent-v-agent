-- Add home_team and away_team columns to matches table
-- These are populated when creating a replay match from a fixture

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS home_team TEXT,
  ADD COLUMN IF NOT EXISTS away_team TEXT;
