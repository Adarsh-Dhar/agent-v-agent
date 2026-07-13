// Allowed values for each building block, mirroring the design doc (A-L).
const SIGNALS = [
  'odds-movement',
  'odds_movement',
  'score_state',
  'mean_reversion',
  'momentum',
  'time_decay',
  'volatility_spike',
];

const SIZING = ['fixed', 'percent_of_budget', 'percentage', 'confidence_weighted'];
const EXIT = ['stop_loss_take_profit', 'stop-loss', 'time_based', 'signal_reversal'];
const AGGRESSION = ['instant', 'confirmation', 'cooldown'];
const DIRECTION = ['long_only', 'short_only', 'bidirectional'];
const TARGET_SELECTION = ['favorite_only', 'underdog_only', 'first_trigger', 'both'];
const PHASE_WEIGHTING = ['uniform', 'front_loaded', 'back_loaded', 'event_triggered'];
const REENTRY_RULE = ['no_reentry', 'immediate_reentry', 'capped_reentry'];
const PORTFOLIO_BEHAVIOR = ['independent', 'shared_bankroll', 'correlated_hedging'];
const ADAPTIVITY = ['static', 'self_adjusting', 'llm_reflective'];

/**
 * Validates a POST body against the strategy schema.
 * Accepts both nested config format (for backward compatibility) and flat format.
 * Throws an Error with a descriptive message on the first problem found.
 */
export function validateAgentConfig(body) {
  const errors = [];

  if (!body.match_id || typeof body.match_id !== 'string') {
    errors.push('match_id is required (string) - the TxLINE match identifier.');
  }

  if (body.budget_cap !== undefined && (typeof body.budget_cap !== 'number' || body.budget_cap <= 0)) {
    errors.push('budget_cap must be a positive number if provided.');
  }

  const cfg = body.config || {};

  // Support both nested config and direct body properties
  const signalType = cfg.signal?.type || body.signal_type;
  const sizingType = cfg.sizing?.type || body.position_sizing;
  const exitType = cfg.exit?.type || body.exit_rule;
  const aggressionType = cfg.aggression?.type || body.aggression;
  const direction = cfg.direction || body.direction_bias;
  const targetSelection = cfg.target_selection || body.target_selection;
  const phaseWeighting = cfg.phase_weighting || body.phase_weighting;
  const reentryRule = cfg.reentry_rule || body.reentry_rule;
  const portfolioBehavior = cfg.portfolio_behavior || body.portfolio_behavior;
  const adaptivity = body.adaptivity_mode || cfg.adaptivity;

  if (signalType && !SIGNALS.includes(signalType)) {
    errors.push(`signal_type must be one of: ${SIGNALS.join(', ')}`);
  }

  if (sizingType && !SIZING.includes(sizingType)) {
    errors.push(`position_sizing must be one of: ${SIZING.join(', ')}`);
  }

  if (exitType && !EXIT.includes(exitType)) {
    errors.push(`exit_rule must be one of: ${EXIT.join(', ')}`);
  }

  if (aggressionType && !AGGRESSION.includes(aggressionType)) {
    errors.push(`aggression must be one of: ${AGGRESSION.join(', ')}`);
  }

  if (direction && !DIRECTION.includes(direction)) {
    errors.push(`direction_bias must be one of: ${DIRECTION.join(', ')} (or omitted)`);
  }

  if (targetSelection && !TARGET_SELECTION.includes(targetSelection)) {
    errors.push(`target_selection must be one of: ${TARGET_SELECTION.join(', ')}`);
  }

  if (phaseWeighting && !PHASE_WEIGHTING.includes(phaseWeighting)) {
    errors.push(`phase_weighting must be one of: ${PHASE_WEIGHTING.join(', ')}`);
  }

  if (reentryRule && !REENTRY_RULE.includes(reentryRule)) {
    errors.push(`reentry_rule must be one of: ${REENTRY_RULE.join(', ')}`);
  }

  if (portfolioBehavior && !PORTFOLIO_BEHAVIOR.includes(portfolioBehavior)) {
    errors.push(`portfolio_behavior must be one of: ${PORTFOLIO_BEHAVIOR.join(', ')}`);
  }

  if (adaptivity && !ADAPTIVITY.includes(adaptivity)) {
    errors.push(`adaptivity_mode must be one of: ${ADAPTIVITY.join(', ')} (or omitted)`);
  }

  // Validate numeric ranges
  if (body.odds_threshold !== undefined) {
    if (typeof body.odds_threshold !== 'number' || body.odds_threshold < 1 || body.odds_threshold > 50) {
      errors.push('odds_threshold must be a number between 1 and 50');
    }
  }

  if (body.odds_timeframe !== undefined) {
    if (typeof body.odds_timeframe !== 'number' || body.odds_timeframe < 1 || body.odds_timeframe > 60) {
      errors.push('odds_timeframe must be a number between 1 and 60');
    }
  }

  if (body.fixed_stake !== undefined) {
    if (typeof body.fixed_stake !== 'number' || body.fixed_stake < 10 || body.fixed_stake > 1000) {
      errors.push('fixed_stake must be a number between 10 and 1000');
    }
  }

  if (body.percentage_stake !== undefined) {
    if (typeof body.percentage_stake !== 'number' || body.percentage_stake < 1 || body.percentage_stake > 100) {
      errors.push('percentage_stake must be a number between 1 and 100');
    }
  }

  if (body.stop_loss !== undefined) {
    if (typeof body.stop_loss !== 'number' || body.stop_loss < 1 || body.stop_loss > 50) {
      errors.push('stop_loss must be a number between 1 and 50');
    }
  }

  if (body.take_profit !== undefined) {
    if (typeof body.take_profit !== 'number' || body.take_profit < 1 || body.take_profit > 50) {
      errors.push('take_profit must be a number between 1 and 50');
    }
  }

  if (body.cooldown_minutes !== undefined) {
    if (typeof body.cooldown_minutes !== 'number' || body.cooldown_minutes < 1 || body.cooldown_minutes > 30) {
      errors.push('cooldown_minutes must be a number between 1 and 30');
    }
  }

  // Validate new numeric fields
  if (body.max_reentries !== undefined) {
    if (typeof body.max_reentries !== 'number' || body.max_reentries < 0 || body.max_reentries > 20) {
      errors.push('max_reentries must be a number between 0 and 20');
    }
  }

  if (body.volatility_threshold !== undefined) {
    if (typeof body.volatility_threshold !== 'number' || body.volatility_threshold < 0 || body.volatility_threshold > 100) {
      errors.push('volatility_threshold must be a number between 0 and 100');
    }
  }

  if (body.mean_reversion_threshold !== undefined) {
    if (typeof body.mean_reversion_threshold !== 'number' || body.mean_reversion_threshold < 0 || body.mean_reversion_threshold > 50) {
      errors.push('mean_reversion_threshold must be a number between 0 and 50');
    }
  }

  if (body.momentum_threshold !== undefined) {
    if (typeof body.momentum_threshold !== 'number' || body.momentum_threshold < 0 || body.momentum_threshold > 50) {
      errors.push('momentum_threshold must be a number between 0 and 50');
    }
  }

  if (body.max_exposure_pct !== undefined) {
    if (typeof body.max_exposure_pct !== 'number' || body.max_exposure_pct < 0 || body.max_exposure_pct > 100) {
      errors.push('max_exposure_pct must be a number between 0 and 100');
    }
  }

  if (body.max_drawdown_stop_pct !== undefined) {
    if (typeof body.max_drawdown_stop_pct !== 'number' || body.max_drawdown_stop_pct < 0 || body.max_drawdown_stop_pct > 100) {
      errors.push('max_drawdown_stop_pct must be a number between 0 and 100');
    }
  }

  if (body.confirmation_threshold !== undefined) {
    if (typeof body.confirmation_threshold !== 'number' || body.confirmation_threshold < 1 || body.confirmation_threshold > 10) {
      errors.push('confirmation_threshold must be a number between 1 and 10');
    }
  }

  if (errors.length) {
    throw new Error(errors.join(' | '));
  }

  return true;
}
