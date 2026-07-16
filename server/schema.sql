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

-- Create agent_runs table for session-based execution
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL,
  budget_cap NUMERIC NOT NULL DEFAULT 5000,
  balance NUMERIC NOT NULL DEFAULT 0,
  realized_pnl NUMERIC DEFAULT 0,
  unrealized_pnl NUMERIC DEFAULT 0,
  trade_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  pid INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_runs_agent_id_idx ON public.agent_runs(agent_id);
CREATE INDEX IF NOT EXISTS agent_runs_match_id_idx ON public.agent_runs(match_id);

-- Add run_id column to trades table
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES public.agent_runs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS trades_run_id_idx ON public.trades(run_id);

-- Create match_clocks table: shared, race-safe authoritative "match start"
-- epoch for replay/mock matches. Multiple independently-spawned agent
-- processes trading the same match_id all read this single row instead of
-- each seeding a start time from their own Date.now(), which is what
-- previously caused their timelines to drift apart (see matchClock.js).
CREATE TABLE IF NOT EXISTS public.match_clocks (
  match_id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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

-- New config: Market Focus, Decision Style, Confirmation Tolerance,
-- Side Bias, Reaction Latency, Context Awareness, Wildcard Traits
ALTER TABLE public.agents
ADD COLUMN IF NOT EXISTS market_focus TEXT DEFAULT '1x2',
ADD COLUMN IF NOT EXISTS ah_line_band TEXT,                    -- 'tight' | 'deep', only used when market_focus = 'asian_handicap'
ADD COLUMN IF NOT EXISTS ou_line_band TEXT,                    -- 'low' | 'mid' | 'high', only used when market_focus = 'over_under'
ADD COLUMN IF NOT EXISTS decision_style TEXT DEFAULT 'volatility_breakout',      -- volatility_breakout (only surviving decision style)
ADD COLUMN IF NOT EXISTS confirmation_tolerance TEXT DEFAULT 'adaptive', -- aggressive | conservative | adaptive
ADD COLUMN IF NOT EXISTS score_state_mode TEXT DEFAULT 'momentum_only',  -- favor_chasing | favor_leading | momentum_only
ADD COLUMN IF NOT EXISTS side_bias TEXT DEFAULT 'none',        -- home | away | favorite | underdog | none
ADD COLUMN IF NOT EXISTS risk_profile TEXT DEFAULT 'flat_stake',      -- conservative | aggressive | martingale | flat_stake
ADD COLUMN IF NOT EXISTS reaction_latency_ms INTEGER DEFAULT 3000,
ADD COLUMN IF NOT EXISTS context_venue_aware BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS context_weather_aware BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS context_competition_tier_aware BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS wildcard_trait TEXT DEFAULT 'none';

-- Replace the old technical-indicator phase enum with the new 5-phase set.
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS check_phase_weighting;
ALTER TABLE public.agents ADD CONSTRAINT check_phase_weighting
  CHECK (phase_weighting IN ('early','pre_halftime','second_half','late_stoppage','full_match'));

ALTER TABLE public.agents ADD CONSTRAINT check_market_focus
  CHECK (market_focus IN ('1x2','asian_handicap','over_under','multi_market'));

-- Backfill: decision_style/wildcard_trait values below are being dropped
-- from the allowed sets. Any existing row still on one of them would
-- violate the narrowed CHECK constraints added right after this, so
-- reassign them first.
UPDATE public.agents SET decision_style = 'volatility_breakout'
  WHERE decision_style IN ('anticipatory','confirmatory','balanced');
UPDATE public.agents SET wildcard_trait = 'none'
  WHERE wildcard_trait IN ('rivalry_rage','nostalgia_trader');

ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS check_decision_style;
ALTER TABLE public.agents ADD CONSTRAINT check_decision_style
  CHECK (decision_style IN ('volatility_breakout'));
ALTER TABLE public.agents ADD CONSTRAINT check_confirmation_tolerance
  CHECK (confirmation_tolerance IN ('aggressive','conservative','adaptive'));
ALTER TABLE public.agents ADD CONSTRAINT check_score_state_mode
  CHECK (score_state_mode IN ('favor_chasing','favor_leading','momentum_only'));
ALTER TABLE public.agents ADD CONSTRAINT check_side_bias
  CHECK (side_bias IN ('home','away','favorite','underdog','none'));
ALTER TABLE public.agents ADD CONSTRAINT check_risk_profile
  CHECK (risk_profile IN ('conservative','aggressive','martingale','flat_stake'));
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS check_wildcard_trait;
ALTER TABLE public.agents ADD CONSTRAINT check_wildcard_trait
  CHECK (wildcard_trait IN ('none','chaos_agent','comeback_romantic','revenge_trader',
    'superstition','weather_prophet','bandwagon','contrarian','last_minute_believer'));

-- H. Match-Phase Weighting / I. Re-entry Rule / L. Risk Ceiling columns
ALTER TABLE public.agents
ADD COLUMN IF NOT EXISTS phase_weighting TEXT DEFAULT 'uniform',
ADD COLUMN IF NOT EXISTS max_reentries INTEGER,
ADD COLUMN IF NOT EXISTS reentry_rule TEXT DEFAULT 'capped_reentry',
ADD COLUMN IF NOT EXISTS max_exposure_pct NUMERIC,
ADD COLUMN IF NOT EXISTS max_drawdown_stop_pct NUMERIC;

-- G. Target Selection column
ALTER TABLE public.agents
ADD COLUMN IF NOT EXISTS target_selection TEXT DEFAULT 'both';

-- J. Portfolio Behavior column
ALTER TABLE public.agents
ADD COLUMN IF NOT EXISTS portfolio_behavior TEXT DEFAULT 'independent';

-- Additional signal parameters for A. Signal
ALTER TABLE public.agents
ADD COLUMN IF NOT EXISTS volatility_threshold NUMERIC,
ADD COLUMN IF NOT EXISTS volatility_timeframe INTEGER,
ADD COLUMN IF NOT EXISTS mean_reversion_threshold NUMERIC,
ADD COLUMN IF NOT EXISTS momentum_threshold NUMERIC,
ADD COLUMN IF NOT EXISTS time_decay_start INTEGER,
ADD COLUMN IF NOT EXISTS time_decay_end INTEGER,
ADD COLUMN IF NOT EXISTS odds_lookback_ticks INTEGER DEFAULT 3,
ADD COLUMN IF NOT EXISTS odds_threshold_pct NUMERIC DEFAULT 2,
ADD COLUMN IF NOT EXISTS volatility_window INTEGER DEFAULT 6,
ADD COLUMN IF NOT EXISTS breakout_zscore NUMERIC DEFAULT 1.5;

-- Additional position sizing parameter for B. Position Sizing
ALTER TABLE public.agents
ADD COLUMN IF NOT EXISTS confidence_weighted BOOLEAN DEFAULT false;

-- Additional exit rule parameter for C. Exit Rule
ALTER TABLE public.agents
ADD COLUMN IF NOT EXISTS time_based_exit_time TEXT;

-- Additional aggression parameter for D. Aggression
ALTER TABLE public.agents
ADD COLUMN IF NOT EXISTS confirmation_threshold INTEGER DEFAULT 2;

-- Add constraints for new columns (skip if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_target_selection'
    AND conrelid = 'public.agents'::regclass
  ) THEN
    ALTER TABLE public.agents
    ADD CONSTRAINT check_target_selection
    CHECK (target_selection IN ('favorite_only', 'underdog_only', 'first_trigger', 'both'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_portfolio_behavior'
    AND conrelid = 'public.agents'::regclass
  ) THEN
    ALTER TABLE public.agents
    ADD CONSTRAINT check_portfolio_behavior
    CHECK (portfolio_behavior IN ('independent', 'independent_per_match', 'shared_bankroll', 'correlated_hedging'));
  END IF;
END $$;

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
    CHECK (phase_weighting IN ('early', 'pre_halftime', 'second_half', 'late_stoppage', 'full_match'));
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
