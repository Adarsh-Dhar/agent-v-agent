-- Allow multiple ticks per minute for live match feeds.
-- Run this in the Supabase SQL editor.

-- 1. Drop the old PK on (match_id, minute)
ALTER TABLE public.match_ticks DROP CONSTRAINT IF EXISTS match_ticks_pkey;

-- 2. Add auto-incrementing tick_id as new PK
ALTER TABLE public.match_ticks ADD COLUMN IF NOT EXISTS tick_id BIGSERIAL PRIMARY KEY;

-- 3. Keep a unique index for replay dedup (replay still writes 1 tick/min)
--    but for live matches, multiple rows per minute are allowed.
CREATE UNIQUE INDEX IF NOT EXISTS match_ticks_replay_dedup
  ON public.match_ticks(match_id, minute)
  WHERE match_id LIKE 'replay-%';
