// Allowed values for each building block, mirroring the design doc (A-F).
const SIGNALS = [
  'odds_movement',
  'score_state',
  'mean_reversion',
  'momentum',
  'time_decay',
  'volatility_spike',
];

const SIZING = ['fixed', 'percent_of_budget', 'confidence_weighted'];
const EXIT = ['stop_loss_take_profit', 'time_based', 'signal_reversal'];
const AGGRESSION = ['instant', 'confirmation', 'cooldown'];
const DIRECTION = ['long_only', 'short_only', 'bidirectional'];

/**
 * Validates a POST body against the strategy schema.
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

  if (!cfg.signal || !SIGNALS.includes(cfg.signal.type)) {
    errors.push(`config.signal.type must be one of: ${SIGNALS.join(', ')}`);
  }
  if (cfg.signal?.secondary && !SIGNALS.includes(cfg.signal.secondary)) {
    errors.push(`config.signal.secondary must be one of: ${SIGNALS.join(', ')} (or omitted)`);
  }

  if (!cfg.sizing || !SIZING.includes(cfg.sizing.type)) {
    errors.push(`config.sizing.type must be one of: ${SIZING.join(', ')}`);
  }

  if (!cfg.exit || !EXIT.includes(cfg.exit.type)) {
    errors.push(`config.exit.type must be one of: ${EXIT.join(', ')}`);
  }

  if (!cfg.aggression || !AGGRESSION.includes(cfg.aggression.type)) {
    errors.push(`config.aggression.type must be one of: ${AGGRESSION.join(', ')}`);
  }

  if (cfg.direction && !DIRECTION.includes(cfg.direction)) {
    errors.push(`config.direction must be one of: ${DIRECTION.join(', ')} (or omitted)`);
  }

  if (errors.length) {
    throw new Error(errors.join(' | '));
  }

  return true;
}
