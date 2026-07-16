import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Use anon key for reads (GET)
const supabaseClient = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

// Use service role key for writes (POST, PUT, DELETE) - bypasses RLS
const supabaseAdmin = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey)
  : null

export async function GET(request: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: 'Supabase not configured' },
      { status: 500 }
    )
  }

  try {
    const url = new URL(request.url)
    const userId = url.searchParams.get('userId')

    // Build query
    let query = supabaseAdmin.from('agents').select('*')

    // Filter by owner if userId provided
    if (userId) {
      query = query.eq('owner', userId)
    }

    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) {
      console.error('[v0] Supabase error fetching agents:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ agents: data || [] }, { status: 200 })
  } catch (error) {
    console.error('[v0] Error in GET /api/agents:', error)
    return NextResponse.json(
      { error: 'Failed to fetch agents' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: 'Supabase not configured' },
      { status: 500 }
    )
  }

  try {
    const body = await request.json()

    const {
      name,
      description,
      signal_type,
      odds_threshold,
      odds_timeframe,
      position_sizing,
      fixed_stake,
      percentage_stake,
      exit_rule,
      stop_loss,
      take_profit,
      aggression,
      cooldown_minutes,
      direction_bias,
      budget_cap = 10000,
      owner,
      market_focus,
      decision_style,
      phase_weighting,
      reaction_latency_ms,
      context_venue_aware,
      context_weather_aware,
      wildcard_trait,
    } = body

    if (!name) {
      return NextResponse.json(
        { error: 'Agent name is required' },
        { status: 400 }
      )
    }

    if (!owner) {
      return NextResponse.json(
        { error: 'Owner is required' },
        { status: 400 }
      )
    }

    // Use admin client for INSERT to bypass RLS
    const { data, error } = await supabaseAdmin
      .from('agents')
      .insert([
        {
          name,
          description,
          signal_type,
          odds_threshold,
          odds_timeframe,
          position_sizing,
          fixed_stake,
          percentage_stake,
          exit_rule,
          stop_loss,
          take_profit,
          aggression,
          cooldown_minutes,
          direction_bias,
          budget_cap,
          owner,
          balance: budget_cap,
          realized_pnl: 0,
          unrealized_pnl: 0,
          trade_count: 0,
          status: 'active',
        },
      ])
      .select()

    if (error) {
      console.error('[v0] Supabase error creating agent:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json(
      { agent: data?.[0], message: 'Agent created successfully' },
      { status: 201 }
    )
  } catch (error) {
    console.error('[v0] Error in POST /api/agents:', error)
    return NextResponse.json(
      { error: 'Failed to create agent' },
      { status: 500 }
    )
  }
}
