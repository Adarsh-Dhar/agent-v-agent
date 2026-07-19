-- Migrate purse/initial_purse from dollar-scale (integer, default 1000)
-- to SOL-scale (numeric, default 1). Run in Supabase SQL Editor.
--
-- This changes defaults for NEW rows going forward.
-- Existing rows are NOT touched — decide manually if you need to /1000 them.

-- 1. Change column types from integer to numeric (SOL amounts need decimals)
ALTER TABLE public.match_players
  ALTER COLUMN purse TYPE numeric USING purse::numeric,
  ALTER COLUMN purse SET DEFAULT 1;

ALTER TABLE public.match_players
  ALTER COLUMN initial_purse TYPE numeric USING initial_purse::numeric,
  ALTER COLUMN initial_purse SET DEFAULT 1;

-- 2. Also fix the matches table default if it stores initial_purse
-- (some code paths reference matches.initial_purse via match_players join)
