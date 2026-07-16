// Allowed values for each building block, mirroring the design doc (A-L).
const MARKET_FOCUS = ['1x2', 'asian_handicap', 'over_under', 'multi_market'];
const AH_LINE_BAND = ['tight', 'deep'];
const OU_LINE_BAND = ['low', 'mid', 'high'];
const DECISION_STYLE = ['anticipatory', 'confirmatory', 'balanced', 'volatility_breakout'];
const CONFIRMATION_TOLERANCE = ['aggressive', 'conservative', 'adaptive'];
const SCORE_STATE_MODE = ['favor_chasing', 'favor_leading', 'momentum_only'];
const SIDE_BIAS = ['home', 'away', 'favorite', 'underdog', 'none'];
const RISK_PROFILE = ['conservative', 'aggressive', 'martingale', 'flat_stake'];
const WILDCARD_TRAIT = [
  'none', 'chaos_agent', 'comeback_romantic', 'revenge_trader', 'superstition',
  'weather_prophet', 'rivalry_rage', 'bandwagon', 'contrarian',
  'last_minute_believer', 'nostalgia_trader',
];

const SIZING = ['fixed', 'percent_of_budget', 'percentage', 'confidence_weighted'];
const EXIT = ['stop_loss_take_profit', 'stop-loss', 'time_based', 'signal_reversal'];
const AGGRESSION = ['instant', 'confirmation', 'cooldown'];
const DIRECTION = ['long_only', 'short_only', 'bidirectional'];
const TARGET_SELECTION = ['favorite_only', 'underdog_only', 'first_trigger', 'both'];
const PHASE_WEIGHTING = ['early', 'pre_halftime', 'second_half', 'late_stoppage', 'full_match'];
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

  const cfg = body.config || {};

  // Support both nested config and direct body properties
  const marketFocus = cfg.market_focus || body.market_focus;
  const ahLineBand = cfg.ah_line_band || body.ah_line_band;
  const ouLineBand = cfg.ou_line_band || body.ou_line_band;
  const decisionStyle = cfg.decision_style || body.decision_style;
  const confirmationTolerance = cfg.confirmation_tolerance || body.confirmation_tolerance;
  const scoreStateMode = cfg.score_state_mode || body.score_state_mode;
  const sideBias = cfg.side_bias || body.side_bias;
  const riskProfile = cfg.risk_profile || body.risk_profile;
  const wildcardTrait = cfg.wildcard_trait || body.wildcard_trait;
  const sizingType = cfg.sizing?.type || body.position_sizing;
  const exitType = cfg.exit?.type || body.exit_rule;
  const aggressionType = cfg.aggression?.type || body.aggression;
  const direction = cfg.direction || body.direction_bias;
  const targetSelection = cfg.target_selection || body.target_selection;
  const phaseWeighting = cfg.phase_weighting || body.phase_weighting;
  const reentryRule = cfg.reentry_rule || body.reentry_rule;
  const portfolioBehavior = cfg.portfolio_behavior || body.portfolio_behavior;
  const adaptivity = body.adaptivity_mode || cfg.adaptivity;

  if (marketFocus && !MARKET_FOCUS.includes(marketFocus)) {
    errors.push(`market_focus must be one of: ${MARKET_FOCUS.join(', ')}`);
  }
  if (marketFocus === 'asian_handicap' && ahLineBand && !AH_LINE_BAND.includes(ahLineBand)) {
    errors.push(`ah_line_band must be one of: ${AH_LINE_BAND.join(', ')}`);
  }
  if (marketFocus === 'over_under' && ouLineBand && !OU_LINE_BAND.includes(ouLineBand)) {
    errors.push(`ou_line_band must be one of: ${OU_LINE_BAND.join(', ')}`);
  }
  if (decisionStyle && !DECISION_STYLE.includes(decisionStyle)) {
    errors.push(`decision_style must be one of: ${DECISION_STYLE.join(', ')}`);
  }
  if (confirmationTolerance && !CONFIRMATION_TOLERANCE.includes(confirmationTolerance)) {
    errors.push(`confirmation_tolerance must be one of: ${CONFIRMATION_TOLERANCE.join(', ')}`);
  }
  if (scoreStateMode && !SCORE_STATE_MODE.includes(scoreStateMode)) {
    errors.push(`score_state_mode must be one of: ${SCORE_STATE_MODE.join(', ')}`);
  }
  if (sideBias && !SIDE_BIAS.includes(sideBias)) {
    errors.push(`side_bias must be one of: ${SIDE_BIAS.join(', ')}`);
  }
  if (riskProfile && !RISK_PROFILE.includes(riskProfile)) {
    errors.push(`risk_profile must be one of: ${RISK_PROFILE.join(', ')}`);
  }
  if (wildcardTrait && !WILDCARD_TRAIT.includes(wildcardTrait)) {
    errors.push(`wildcard_trait must be one of: ${WILDCARD_TRAIT.join(', ')}`);
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

  // Reaction Latency: Instant (0) / Fast (2000-5000ms) / Delayed (15000-30000ms) — validate as a single bounded field.
  if (body.reaction_latency_ms !== undefined) {
    if (typeof body.reaction_latency_ms !== 'number' || body.reaction_latency_ms < 0 || body.reaction_latency_ms > 30000) {
      errors.push('reaction_latency_ms must be a number between 0 and 30000');
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

  // Odds-only signal family (volatility_breakout is the only surviving member —
  // momentum and mean_reversion were removed along with odds_lookback_ticks /
  // odds_threshold_pct, which only they consumed).
  if (body.volatility_window !== undefined) {
    if (typeof body.volatility_window !== 'number' || body.volatility_window < 3 || body.volatility_window > 20) {
      errors.push('volatility_window must be a number between 3 and 20');
    }
  }

  if (body.breakout_zscore !== undefined) {
    if (typeof body.breakout_zscore !== 'number' || body.breakout_zscore < 1.0 || body.breakout_zscore > 4.0) {
      errors.push('breakout_zscore must be a number between 1.0 and 4.0');
    }
  }

  if (errors.length) {
    throw new Error(errors.join(' | '));
  }

  return true;
}

/**
 * Validates run-specific configuration (match_id, budget_cap).
 * These are session-specific parameters, not permanent agent config.
 */
export function validateRunConfig(body) {
  const errors = [];
  if (!body.match_id || typeof body.match_id !== 'string') {
    errors.push('match_id is required (string).');
  }
  if (body.budget_cap === undefined || typeof body.budget_cap !== 'number' || body.budget_cap <= 0) {
    errors.push('budget_cap is required and must be a positive number.');
  }
  if (errors.length) throw new Error(errors.join(' '));
}
