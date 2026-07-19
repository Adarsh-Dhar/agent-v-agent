-- Add match_minute column to trades table for time synchronization with match odds
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS match_minute INTEGER;
