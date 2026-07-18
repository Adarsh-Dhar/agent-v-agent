import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey)
  : null

// Live odds/score/minute feed for a match, independent of any agent's
// trades -- lets the frontend show "what the market is doing right now"
// at the same time agents are trading on it.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  }

  try {
    const { code } = await params
    if (!code) {
      return NextResponse.json({ error: 'Bad Request: Match code is required' }, { status: 400 })
    }

    const { data: match, error: matchError } = await supabaseAdmin
      .from('matches')
      .select('id, agent_match_id')
      .eq('code', code.toUpperCase())
      .single()

    if (matchError || !match) {
      return NextResponse.json({ error: 'Not Found: Match with this code does not exist' }, { status: 404 })
    }

    // Same rule used everywhere else: replay matches trade under
    // agent_match_id (e.g. "replay-18241006"), live matches under match.id.
    const matchIdForAgents = match.agent_match_id || match.id

    const { data: ticks, error: ticksError } = await supabaseAdmin
      .from('match_ticks')
      .select('minute, odds, score_home, score_away, event, created_at')
      .eq('match_id', matchIdForAgents)
      .order('created_at', { ascending: true })

    if (ticksError) {
      console.error('[v0] Database error fetching match ticks:', ticksError)
      return NextResponse.json({ error: 'Internal Server Error: Failed to fetch match ticks' }, { status: 500 })
    }

    return NextResponse.json({ ticks: ticks || [] }, { status: 200 })
  } catch (error) {
    console.error('[v0] Error in GET /api/matches/[code]/ticks:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
