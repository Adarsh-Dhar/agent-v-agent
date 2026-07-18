-- Add missing columns to trades table for PnL tracking
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS pnl NUMERIC,
  ADD COLUMN IF NOT EXISTS balance_after NUMERIC;
