import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey)
  : null

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: 'Supabase not configured' },
      { status: 500 }
    )
  }

  try {
    const { id } = await params
    const body = await request.json()
    const { agent_id, agent_name } = body

    if (!agent_id || !agent_name) {
      return NextResponse.json(
        { error: 'agent_id and agent_name are required' },
        { status: 400 }
      )
    }

    // Fetch the match_player to get the match_id
    const { data: playerData, error: playerError } = await supabaseAdmin
      .from('match_players')
      .select('match_id')
      .eq('id', id)
      .single()

    if (playerError || !playerData) {
      return NextResponse.json(
        { error: 'Player not found' },
        { status: 404 }
      )
    }

    // Fetch the match to check its status
    const { data: matchData, error: matchError } = await supabaseAdmin
      .from('matches')
      .select('status')
      .eq('id', playerData.match_id)
      .single()

    if (matchError || !matchData) {
      return NextResponse.json(
        { error: 'Match not found' },
        { status: 404 }
      )
    }

    // Only allow agent swaps when match is pending
    if (matchData.status !== 'pending') {
      return NextResponse.json(
        { error: `Match is ${matchData.status} and agent swaps are no longer allowed` },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('match_players')
      .update({
        agent_id,
        agent_name,
      })
      .eq('id', id)
      .select()

    if (error) {
      console.error('[v0] Error updating player agent:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json(
      { player: data?.[0], message: 'Agent selected successfully' },
      { status: 200 }
    )
  } catch (error) {
    console.error('[v0] Error in PUT /api/match-players/[id]:', error)
    return NextResponse.json({ error: 'Failed to select agent' }, { status: 500 })
  }
}
