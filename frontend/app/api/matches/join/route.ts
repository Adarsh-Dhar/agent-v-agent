import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey)
  : null

export async function POST(request: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: 'Supabase not configured' },
      { status: 500 }
    )
  }

  try {
    const body = await request.json()
    const { code, userId, userName } = body

    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { error: 'Match code is required' },
        { status: 400 }
      )
    }

    if (!userId || !userName) {
      return NextResponse.json(
        { error: 'User information is required' },
        { status: 400 }
      )
    }

    const userIdCookie = userId
    const userNameCookie = userName

    // Find the match by code
    const { data: matchData, error: matchError } = await supabaseAdmin
      .from('matches')
      .select('*')
      .eq('code', code.toUpperCase())
      .single()

    if (matchError || !matchData) {
      return NextResponse.json(
        { error: 'Match not found' },
        { status: 404 }
      )
    }

    if (matchData.status !== 'pending') {
      return NextResponse.json(
        { error: `Match is ${matchData.status} and can no longer be joined` },
        { status: 400 }
      )
    }

    // Check if user is already a member
    const { data: existingPlayer } = await supabaseAdmin
      .from('match_players')
      .select('*')
      .eq('match_id', matchData.id)
      .eq('player_id', userIdCookie)
      .single()

    if (existingPlayer) {
      // User is already a member, just return success
      return NextResponse.json(
        { message: 'User already a member of this match', matchId: matchData.id },
        { status: 200 }
      )
    }

    // Check if match is full
    const { count: playerCount } = await supabaseAdmin
      .from('match_players')
      .select('*', { count: 'exact', head: true })
      .eq('match_id', matchData.id)

    if (playerCount && playerCount >= matchData.max_players) {
      return NextResponse.json(
        { error: 'Match is full' },
        { status: 400 }
      )
    }

    // Add user to the match as a player
    const initialPurse = matchData.initial_purse || 0.001
    const { data: insertedData, error: insertError } = await supabaseAdmin
      .from('match_players')
      .insert({
        match_id: matchData.id,
        player_id: userIdCookie,
        player_name: userNameCookie,
        purse: initialPurse,
        initial_purse: initialPurse,
        pnl: 0,
      })
      .select()

    if (insertError) {
      console.error('[v0] Error adding player to match:', insertError)
      return NextResponse.json(
        { error: 'Failed to join match' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { message: 'Successfully joined match', matchId: matchData.id, player: insertedData },
      { status: 200 }
    )
  } catch (error) {
    console.error('[v0] Error in POST /api/matches/join:', error)
    return NextResponse.json(
      { error: 'Failed to join match' },
      { status: 500 }
    )
  }
}
