-- Create agents table
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  signal_type TEXT NOT NULL DEFAULT 'odds-movement',
  odds_threshold NUMERIC DEFAULT 5,
  odds_timeframe INTEGER DEFAULT 5,
  position_sizing TEXT NOT NULL DEFAULT 'fixed',
  fixed_stake NUMERIC DEFAULT 100,
  percentage_stake NUMERIC DEFAULT 10,
  exit_rule TEXT NOT NULL DEFAULT 'stop-loss',
  stop_loss NUMERIC DEFAULT 5,
  take_profit NUMERIC DEFAULT 15,
  aggression TEXT NOT NULL DEFAULT 'instant',
  cooldown_minutes INTEGER DEFAULT 2,
  direction_bias TEXT NOT NULL DEFAULT 'bidirectional',
  budget_cap NUMERIC NOT NULL DEFAULT 5000,
  balance NUMERIC DEFAULT 0,
  realized_pnl NUMERIC DEFAULT 0,
  unrealized_pnl NUMERIC DEFAULT 0,
  trade_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on created_at for faster queries
CREATE INDEX IF NOT EXISTS agents_created_at_idx ON agents(created_at DESC);

-- Create index on status for filtering
CREATE INDEX IF NOT EXISTS agents_status_idx ON agents(status);
