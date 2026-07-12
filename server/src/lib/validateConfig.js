// Allowed values for each building block, mirroring the design doc (A-F).
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

  if (typeof body.budget_cap !== 'number' || body.budget_cap <= 0) {
    errors.push('budget_cap is required and must be a positive number.');
  }

  const cfg = body.config || {};

  // Support both nested config and direct body properties
  const signalType = cfg.signal?.type || body.signal_type;
  const sizingType = cfg.sizing?.type || body.position_sizing;
  const exitType = cfg.exit?.type || body.exit_rule;
  const aggressionType = cfg.aggression?.type || body.aggression;
  const direction = cfg.direction || body.direction_bias;
  const adaptivity = body.adaptivity_mode || cfg.adaptivity;

  if (!signalType || !SIGNALS.includes(signalType)) {
    errors.push(`signal_type must be one of: ${SIGNALS.join(', ')}`);
  }

  if (!sizingType || !SIZING.includes(sizingType)) {
    errors.push(`position_sizing must be one of: ${SIZING.join(', ')}`);
  }

  if (!exitType || !EXIT.includes(exitType)) {
    errors.push(`exit_rule must be one of: ${EXIT.join(', ')}`);
  }

  if (!aggressionType || !AGGRESSION.includes(aggressionType)) {
    errors.push(`aggression must be one of: ${AGGRESSION.join(', ')}`);
  }

  if (direction && !DIRECTION.includes(direction)) {
    errors.push(`direction_bias must be one of: ${DIRECTION.join(', ')} (or omitted)`);
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

  if (errors.length) {
    throw new Error(errors.join(' | '));
  }

  return true;
}
