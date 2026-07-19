ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS check_target_selection;
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS check_reentry_rule;
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS check_portfolio_behavior;
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS check_risk_profile;

ALTER TABLE public.agents
  DROP COLUMN IF EXISTS target_selection,
  DROP COLUMN IF EXISTS reentry_rule,
  DROP COLUMN IF EXISTS portfolio_behavior;

UPDATE public.agents
  SET risk_profile = 'flat_stake'
  WHERE risk_profile NOT IN ('martingale', 'flat_stake');

ALTER TABLE public.agents
  ADD CONSTRAINT check_risk_profile CHECK (risk_profile IN ('martingale', 'flat_stake'));
