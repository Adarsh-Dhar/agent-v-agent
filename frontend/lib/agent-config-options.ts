// Single source of truth for agent configuration enums
// Mirrors server/src/lib/validateConfig.js exactly to prevent drift

export const MARKET_FOCUS = ['1x2', 'asian_handicap', 'over_under', 'multi_market'] as const
export const AH_LINE_BAND = ['tight', 'deep'] as const
export const OU_LINE_BAND = ['low', 'mid', 'high'] as const
export const DECISION_STYLE = ['volatility_breakout'] as const
export const CONFIRMATION_TOLERANCE = ['aggressive', 'conservative', 'adaptive'] as const
export const SCORE_STATE_MODE = ['favor_chasing', 'favor_leading', 'momentum_only'] as const
export const SIDE_BIAS = ['home', 'away', 'favorite', 'underdog', 'none'] as const
export const RISK_PROFILE = ['martingale', 'flat_stake'] as const
export const WILDCARD_TRAIT = [
  'none',
  'chaos_agent',
  'comeback_romantic',
  'revenge_trader',
  'superstition',
  'weather_prophet',
  'bandwagon',
  'contrarian',
  'last_minute_believer',
] as const
export const SIZING = ['fixed', 'percent_of_budget', 'percentage', 'confidence_weighted'] as const
export const EXIT = ['stop_loss_take_profit', 'stop-loss', 'time_based', 'signal_reversal'] as const
export const AGGRESSION = ['instant', 'confirmation', 'cooldown'] as const
export const DIRECTION = ['long_only', 'short_only', 'bidirectional'] as const
export const PHASE_WEIGHTING = ['early', 'pre_halftime', 'second_half', 'late_stoppage', 'full_match'] as const
export const ADAPTIVITY = ['static', 'self_adjusting', 'llm_reflective'] as const

// Type exports for TypeScript
export type MarketFocus = (typeof MARKET_FOCUS)[number]
export type AhLineBand = (typeof AH_LINE_BAND)[number]
export type OuLineBand = (typeof OU_LINE_BAND)[number]
export type DecisionStyle = (typeof DECISION_STYLE)[number]
export type ConfirmationTolerance = (typeof CONFIRMATION_TOLERANCE)[number]
export type ScoreStateMode = (typeof SCORE_STATE_MODE)[number]
export type SideBias = (typeof SIDE_BIAS)[number]
export type RiskProfile = (typeof RISK_PROFILE)[number]
export type WildcardTrait = (typeof WILDCARD_TRAIT)[number]
export type Sizing = (typeof SIZING)[number]
export type Exit = (typeof EXIT)[number]
export type Aggression = (typeof AGGRESSION)[number]
export type Direction = (typeof DIRECTION)[number]
export type PhaseWeighting = (typeof PHASE_WEIGHTING)[number]
export type Adaptivity = (typeof ADAPTIVITY)[number]
