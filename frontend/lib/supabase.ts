import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

export type Agent = {
  id: string
  name: string
  description: string
  signal_type: string
  odds_threshold: number
  odds_timeframe: number
  position_sizing: string
  fixed_stake: number
  percentage_stake: number
  exit_rule: string
  stop_loss: number
  take_profit: number
  aggression: string
  cooldown_minutes: number
  direction_bias: string
  budget_cap: number
  balance: number
  realized_pnl: number
  unrealized_pnl: number
  trade_count: number
  status: 'active' | 'inactive' | 'paused'
  created_at: string
  updated_at: string
  // New config-factor architecture fields
  market_focus?: string
  ah_line_band?: string
  ou_line_band?: string
  decision_style?: string
  confirmation_tolerance?: string
  score_state_mode?: string
  side_bias?: string
  risk_profile?: string
  reaction_latency_ms?: number
  context_venue_aware?: boolean
  context_weather_aware?: boolean
  context_competition_tier_aware?: boolean
  wildcard_trait?: string
  phase_weighting?: string
  max_reentries?: number
  reentry_rule?: string
  max_exposure_pct?: number
  max_drawdown_stop_pct?: number
  target_selection?: string
  portfolio_behavior?: string
  volatility_threshold?: number
  volatility_timeframe?: number
  mean_reversion_threshold?: number
  momentum_threshold?: number
  time_decay_start?: number
  time_decay_end?: number
  confidence_weighted?: boolean
  time_based_exit_time?: string
  confirmation_threshold?: number
  odds_lookback_ticks?: number
  odds_threshold_pct?: number
  volatility_window?: number
  breakout_zscore?: number
  adaptivity_mode?: string
  llm_reflection_enabled?: boolean
  last_reflection_timestamp?: string
  match_id?: string
  owner?: string
  pid?: number
  secondary_signal_type?: string
  secondary_signal_threshold?: number
  score_state_triggers?: string[]
}

export type Game = {
  id: string
  name: string
  description: string | null
  sport: string
  team_a: string
  team_b: string
  status: 'upcoming' | 'ongoing' | 'completed'
  start_time: string | null
  end_time: string | null
  location: string | null
  created_at: string
  updated_at: string
}

export type Player = {
  id: string
  user_id: string
  email: string
  name: string
  bio: string | null
  avatar_url: string | null
  total_trades: number
  total_pnl: number
  win_rate: number
  created_at: string
  updated_at: string
}

export type Match = {
  id: string
  code: string
  secret_code: string
  title: string
  description: string
  creator_id: string
  creator_name: string
  game_id: string | null
  initial_purse: number
  status: 'pending' | 'active' | 'completed'
  max_players: number
  agent_match_id?: string
  is_replay?: boolean
  fixture_id?: string | number
  home_team?: string
  away_team?: string
  created_at: string
  updated_at: string
}

export type MatchPlayer = {
  id: string
  match_id: string
  player_id: string
  player_name: string
  agent_id: string | null
  agent_name: string | null
  purse: number
  initial_purse: number
  pnl: number
  created_at: string
  updated_at: string
}
