ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS tx_signature TEXT;
