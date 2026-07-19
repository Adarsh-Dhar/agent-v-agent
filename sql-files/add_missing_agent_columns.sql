-- Run in the Supabase SQL editor AFTER server/schema.sql (which already adds
-- market_focus, decision_style, wildcard_trait, phase_weighting, etc).
-- These columns are written by POST /agents in server/src/server.js but
-- were never added by any existing migration.

ALTER TABLE public.agents
ADD COLUMN IF NOT EXISTS odds_lookback_ticks INTEGER DEFAULT 3,
ADD COLUMN IF NOT EXISTS odds_threshold_pct NUMERIC DEFAULT 2,
ADD COLUMN IF NOT EXISTS volatility_window INTEGER DEFAULT 6,
ADD COLUMN IF NOT EXISTS breakout_zscore NUMERIC DEFAULT 1.5,
ADD COLUMN IF NOT EXISTS ah_line_band text,
ADD COLUMN IF NOT EXISTS ou_line_band text,
ADD COLUMN IF NOT EXISTS score_state_mode text DEFAULT 'momentum_only',
ADD COLUMN IF NOT EXISTS side_bias text DEFAULT 'none',
ADD COLUMN IF NOT EXISTS risk_profile text DEFAULT 'flat_stake',
ADD COLUMN IF NOT EXISTS reaction_latency_ms integer DEFAULT 3000,
ADD COLUMN IF NOT EXISTS context_venue_aware boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS context_weather_aware boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS context_competition_tier_aware boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS confidence_weighted boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS time_based_exit_time text,
ADD COLUMN IF NOT EXISTS confirmation_threshold integer DEFAULT 2,
ADD COLUMN IF NOT EXISTS reentry_rule text DEFAULT 'capped_reentry',
ADD COLUMN IF NOT EXISTS max_reentries integer DEFAULT 5,
ADD COLUMN IF NOT EXISTS adaptivity_mode text DEFAULT 'static',
ADD COLUMN IF NOT EXISTS llm_reflection_enabled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS max_exposure_pct numeric,
ADD COLUMN IF NOT EXISTS max_drawdown_stop_pct numeric;

-- Fix confirmation_tolerance type (was created as numeric, needs to be text)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'agents' 
    AND column_name = 'confirmation_tolerance' 
    AND data_type = 'numeric'
  ) THEN
    ALTER TABLE public.agents ALTER COLUMN confirmation_tolerance TYPE text USING confirmation_tolerance::text;
  END IF;
END $$;

-- Add confirmation_tolerance as text if it doesn't exist
ALTER TABLE public.agents
ADD COLUMN IF NOT EXISTS confirmation_tolerance text DEFAULT 'adaptive';

-- Drop phase_weighting check constraint first
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_phase_weighting') THEN
    ALTER TABLE public.agents DROP CONSTRAINT check_phase_weighting;
  END IF;
END $$;

-- Fix existing phase_weighting values that don't match the constraint
UPDATE public.agents 
SET phase_weighting = 'full_match' 
WHERE phase_weighting IS NULL OR phase_weighting NOT IN ('early', 'pre_halftime', 'second_half', 'late_stoppage', 'full_match');

-- Recreate phase_weighting check constraint with all valid values
ALTER TABLE public.agents
ADD CONSTRAINT check_phase_weighting 
CHECK (phase_weighting IN ('early', 'pre_halftime', 'second_half', 'late_stoppage', 'full_match'));

-- Drop target_selection check constraint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_target_selection') THEN
    ALTER TABLE public.agents DROP CONSTRAINT check_target_selection;
  END IF;
END $$;

-- Fix existing target_selection values that don't match the constraint
UPDATE public.agents 
SET target_selection = 'both' 
WHERE target_selection IS NULL OR target_selection NOT IN ('favorite_only', 'underdog_only', 'first_trigger', 'both');

-- Recreate target_selection check constraint with all valid values
ALTER TABLE public.agents
ADD CONSTRAINT check_target_selection 
CHECK (target_selection IN ('favorite_only', 'underdog_only', 'first_trigger', 'both'));
