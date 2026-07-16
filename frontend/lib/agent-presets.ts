export interface AgentPreset {
  id: string
  name: string
  description: string
  marketFocus: '1x2' | 'asian_handicap' | 'over_under' | 'multi_market'
  decisionStyle: 'volatility_breakout'
  aggressionType: 'instant' | 'confirmation' | 'cooldown'
  confirmationTolerance: 'aggressive' | 'conservative' | 'adaptive'
  phaseWeighting: 'early' | 'pre_halftime' | 'second_half' | 'late_stoppage' | 'full_match'
  sideBias: 'home' | 'away' | 'favorite' | 'underdog' | 'none'
  positionSizing: 'fixed' | 'percentage' | 'confidence_weighted'
  reactionLatencyMs: number
  contextVenueAware: boolean
  contextWeatherAware: boolean
  wildcardTrait: string
  volatilityWindow?: number
  breakoutZscore?: number
}

export const AGENT_PRESETS: AgentPreset[] = [
  {
    id: 'comeback-romantic',
    name: 'Comeback Romantic',
    description: 'Favors underdog teams with comeback wildcard trait - emotional betting style',
    marketFocus: '1x2',
    decisionStyle: 'volatility_breakout',
    aggressionType: 'cooldown',
    confirmationTolerance: 'adaptive',
    phaseWeighting: 'second_half',
    sideBias: 'underdog',
    positionSizing: 'confidence_weighted',
    reactionLatencyMs: 3000,
    contextVenueAware: false,
    contextWeatherAware: false,
    wildcardTrait: 'comeback_romantic',
  },
  {
    id: 'revenge-trader',
    name: 'Revenge Trader',
    description: 'Reverses losing trades with the revenge trader wildcard - responds to losses',
    marketFocus: '1x2',
    decisionStyle: 'volatility_breakout',
    aggressionType: 'instant',
    confirmationTolerance: 'aggressive',
    phaseWeighting: 'full_match',
    sideBias: 'none',
    positionSizing: 'fixed',
    reactionLatencyMs: 1000,
    contextVenueAware: false,
    contextWeatherAware: false,
    wildcardTrait: 'revenge_trader',
  },
  {
    id: 'contrarian-specialist',
    name: 'Contrarian Specialist',
    description: 'Takes opposite positions to consensus - thrives in unexpected situations',
    marketFocus: 'multi_market',
    decisionStyle: 'volatility_breakout',
    aggressionType: 'confirmation',
    confirmationTolerance: 'conservative',
    phaseWeighting: 'early',
    sideBias: 'none',
    positionSizing: 'percentage',
    reactionLatencyMs: 2500,
    contextVenueAware: true,
    contextWeatherAware: true,
    wildcardTrait: 'contrarian',
  },
  {
    id: 'last-minute-believer',
    name: 'Last Minute Believer',
    description: 'Only activates in final 15 minutes with high-conviction trades',
    marketFocus: '1x2',
    decisionStyle: 'volatility_breakout',
    aggressionType: 'instant',
    confirmationTolerance: 'aggressive',
    phaseWeighting: 'late_stoppage',
    sideBias: 'none',
    positionSizing: 'fixed',
    reactionLatencyMs: 500,
    contextVenueAware: false,
    contextWeatherAware: false,
    wildcardTrait: 'last_minute_believer',
  },
  {
    id: 'weather-prophet',
    name: 'Weather Prophet',
    description: 'Weather-aware trading focusing on adverse conditions affecting play',
    marketFocus: 'over_under',
    decisionStyle: 'volatility_breakout',
    aggressionType: 'confirmation',
    confirmationTolerance: 'conservative',
    phaseWeighting: 'full_match',
    sideBias: 'none',
    positionSizing: 'confidence_weighted',
    reactionLatencyMs: 2000,
    contextVenueAware: true,
    contextWeatherAware: true,
    wildcardTrait: 'weather_prophet',
  },
  {
    id: 'volatility-breakout-trader',
    name: 'Volatility Breakout Trader',
    description: 'Detects statistical outliers in odds movements using z-score analysis - pure quantitative approach',
    marketFocus: '1x2',
    decisionStyle: 'volatility_breakout',
    aggressionType: 'instant',
    confirmationTolerance: 'aggressive',
    phaseWeighting: 'full_match',
    sideBias: 'none',
    positionSizing: 'confidence_weighted',
    reactionLatencyMs: 1000,
    contextVenueAware: false,
    contextWeatherAware: false,
    wildcardTrait: 'none',
    volatilityWindow: 6,
    breakoutZscore: 1.5,
  },
]
