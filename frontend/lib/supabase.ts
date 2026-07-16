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
  title: string
  description: string
  creator_id: string
  creator_name: string
  game_id: string | null
  initial_purse: number
  status: 'pending' | 'active' | 'completed'
  max_players: number
  created_at: string
  updated_at: string
}

export type MatchPlayer = {
  id: string
  match_id: string
  user_id: string
  agent_id: string | null
  agent_name: string | null
  purse: number
  initial_purse: number
  pnl: number
  joined_at: string
  updated_at: string
}
