-- Run this in the Supabase SQL editor before starting the server.
-- This schema matches the existing database structure and adds the missing trades table.

-- Agents table (already exists, this is for reference)
-- CREATE TABLE IF NOT EXISTS public.agents (
--   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   name TEXT NOT NULL,
--   description TEXT,
--   signal_type TEXT NOT NULL DEFAULT 'odds-movement',
--   odds_threshold NUMERIC DEFAULT 5,
--   odds_timeframe INTEGER DEFAULT 5,
--   position_sizing TEXT NOT NULL DEFAULT 'fixed',
--   fixed_stake NUMERIC DEFAULT 100,
--   percentage_stake NUMERIC DEFAULT 10,
--   exit_rule TEXT NOT NULL DEFAULT 'stop-loss',
--   stop_loss NUMERIC DEFAULT 5,
--   take_profit NUMERIC DEFAULT 15,
--   aggression TEXT NOT NULL DEFAULT 'instant',
--   cooldown_minutes INTEGER DEFAULT 2,
--   direction_bias TEXT NOT NULL DEFAULT 'bidirectional',
--   budget_cap NUMERIC NOT NULL DEFAULT 5000,
--   balance NUMERIC DEFAULT 0,
--   realized_pnl NUMERIC DEFAULT 0,
--   unrealized_pnl NUMERIC DEFAULT 0,
--   trade_count INTEGER DEFAULT 0,
--   status TEXT DEFAULT 'active',
--   created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
--   updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
-- );

-- Add missing columns to agents table if they don't exist
ALTER TABLE public.agents 
ADD COLUMN IF NOT EXISTS match_id TEXT,
ADD COLUMN IF NOT EXISTS owner TEXT,
ADD COLUMN IF NOT EXISTS pid INTEGER,
ADD COLUMN IF NOT EXISTS secondary_signal_type TEXT,
ADD COLUMN IF NOT EXISTS secondary_signal_threshold NUMERIC,
ADD COLUMN IF NOT EXISTS score_state_triggers TEXT[] DEFAULT ARRAY['goal_home','goal_away','red_card_home','red_card_away','penalties'],
ADD COLUMN IF NOT EXISTS adaptivity_mode TEXT DEFAULT 'static',
ADD COLUMN IF NOT EXISTS llm_reflection_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS last_reflection_timestamp TIMESTAMPTZ;

-- Add constraint for adaptivity_mode (skip if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'check_adaptivity_mode' 
    AND conrelid = 'public.agents'::regclass
  ) THEN
    ALTER TABLE public.agents 
    ADD CONSTRAINT check_adaptivity_mode 
    CHECK (adaptivity_mode IN ('static', 'self_adjusting', 'llm_reflective'));
  END IF;
END $$;

-- Create trades table (missing from existing schema)
CREATE TABLE IF NOT EXISTS public.trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL,
  side TEXT NOT NULL,                    -- 'buy' | 'sell'
  odds NUMERIC NOT NULL,
  stake NUMERIC NOT null,
  reason TEXT,                           -- which signal fired
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for trades table
CREATE INDEX IF NOT EXISTS trades_agent_id_idx ON public.trades(agent_id);
CREATE INDEX IF NOT EXISTS trades_match_id_idx ON public.trades(match_id);

-- Create index on agents.match_id for faster queries
CREATE INDEX IF NOT EXISTS agents_match_id_idx ON public.agents(match_id);

-- Create reflection failures table for logging LLM reflection failures
CREATE TABLE IF NOT EXISTS public.reflection_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validation_layer TEXT NOT NULL,
  error_message TEXT NOT NULL,
  retry_attempt INTEGER NOT NULL,
  llm_output JSONB,
  previous_config JSONB NOT NULL
);

-- Create indexes for reflection failures
CREATE INDEX IF NOT EXISTS reflection_failures_agent_id_idx ON public.reflection_failures(agent_id);
CREATE INDEX IF NOT EXISTS reflection_failures_timestamp_idx ON public.reflection_failures(timestamp DESC);

-- Portfolios table for shared bankroll across agents
CREATE TABLE IF NOT EXISTS public.portfolios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner TEXT,
  balance NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Atomic portfolio balance increment function
CREATE OR REPLACE FUNCTION increment_portfolio_balance(p_portfolio_id UUID, p_delta NUMERIC)
RETURNS public.portfolios AS $$
  UPDATE public.portfolios
  SET balance = balance + p_delta, updated_at = NOW()
  WHERE id = p_portfolio_id
  RETURNING *;
$$ LANGUAGE sql VOLATILE;

-- H. Match-Phase Weighting / I. Re-entry Rule / L. Risk Ceiling columns
ALTER TABLE public.agents
ADD COLUMN IF NOT EXISTS phase_weighting TEXT DEFAULT 'uniform',
ADD COLUMN IF NOT EXISTS max_reentries INTEGER,
ADD COLUMN IF NOT EXISTS reentry_rule TEXT DEFAULT 'capped_reentry',
ADD COLUMN IF NOT EXISTS max_exposure_pct NUMERIC,
ADD COLUMN IF NOT EXISTS max_drawdown_stop_pct NUMERIC,
ADD COLUMN IF NOT EXISTS target_selection TEXT DEFAULT 'first_trigger',
ADD COLUMN IF NOT EXISTS favorite_odds_threshold NUMERIC,
ADD COLUMN IF NOT EXISTS underdog_odds_threshold NUMERIC,
ADD COLUMN IF NOT EXISTS portfolio_behavior TEXT DEFAULT 'independent_per_match',
ADD COLUMN IF NOT EXISTS portfolio_id UUID REFERENCES public.portfolios(id),
ADD COLUMN IF NOT EXISTS correlation_threshold NUMERIC;

-- Add constraint for phase_weighting (skip if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_phase_weighting'
    AND conrelid = 'public.agents'::regclass
  ) THEN
    ALTER TABLE public.agents
    ADD CONSTRAINT check_phase_weighting
    CHECK (phase_weighting IN ('uniform', 'front_loaded', 'back_loaded', 'event_triggered'));
  END IF;
END $$;

-- Add constraint for reentry_rule (skip if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_reentry_rule'
    AND conrelid = 'public.agents'::regclass
  ) THEN
    ALTER TABLE public.agents
    ADD CONSTRAINT check_reentry_rule
    CHECK (reentry_rule IN ('no_reentry', 'immediate_reentry', 'capped_reentry'));
  END IF;
END $$;

-- Add constraint for target_selection (skip if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_target_selection'
    AND conrelid = 'public.agents'::regclass
  ) THEN
    ALTER TABLE public.agents
    ADD CONSTRAINT check_target_selection
    CHECK (target_selection IN ('first_trigger', 'favorite_only', 'underdog_only', 'hedge_both'));
  END IF;
END $$;

-- Add constraint for portfolio_behavior (skip if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_portfolio_behavior'
    AND conrelid = 'public.agents'::regclass
  ) THEN
    ALTER TABLE public.agents
    ADD CONSTRAINT check_portfolio_behavior
    CHECK (portfolio_behavior IN ('independent_per_match', 'shared_bankroll', 'correlated_hedging'));
  END IF;
END $$;
