import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey)
  : null

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: 'Supabase not configured' },
      { status: 500 }
    )
  }

  try {
    let code: string
    try {
      ({ code } = await params)
    } catch (paramError) {
      console.error('[v0] Failed to parse route params:', paramError)
      return NextResponse.json({ error: 'Bad Request: Invalid route parameters' }, { status: 400 })
    }

    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      return NextResponse.json({ error: 'Bad Request: Match code is required' }, { status: 400 })
    }

    // Try to find match by code first, then by secret_code
    let match = null
    let matchError = null

    // First try by code
    const { data: matchByCode, error: codeError } = await supabaseAdmin
      .from('matches')
      .select('*')
      .eq('code', code.toUpperCase())
      .single()

    if (!codeError && matchByCode) {
      match = matchByCode
    } else {
      // If not found by code, try by secret_code
      const { data: matchBySecret, error: secretError } = await supabaseAdmin
        .from('matches')
        .select('*')
        .eq('secret_code', code.toUpperCase())
        .single()

      if (!secretError && matchBySecret) {
        match = matchBySecret
      } else {
        matchError = secretError
      }
    }

    if (matchError && matchError.code !== 'PGRST116') {
      console.error('[v0] Database error fetching match:', matchError)
      return NextResponse.json(
        { error: 'Internal Server Error: Failed to fetch match' },
        { status: 500 }
      )
    }

    if (!match || matchError?.code === 'PGRST116') {
      return NextResponse.json({ error: 'Not Found: Match with this code does not exist' }, { status: 404 })
    }

    const { data: players, error: playersError } = await supabaseAdmin
      .from('match_players')
      .select('*')
      .eq('match_id', match.id)

    if (playersError && playersError.code !== 'PGRST116') {
      console.error('[v0] Database error fetching players:', playersError)
      return NextResponse.json(
        { error: 'Internal Server Error: Failed to fetch match players' },
        { status: 500 }
      )
    }

    console.log('[v0] Fetched players for match', match.id, ':', players)
    return NextResponse.json({ match, players: players || [] }, { status: 200 })
  } catch (error) {
    console.error('[v0] Error in GET /api/matches/[code]:', error)
    return NextResponse.json({ error: 'Internal Server Error: Failed to fetch match' }, { status: 500 })
  }
}

// Join a match
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: 'Supabase not configured' },
      { status: 500 }
    )
  }

  try {
    // Parse route parameters
    let code: string
    try {
      ({ code } = await params)
    } catch (paramError) {
      console.error('[v0] Failed to parse route params:', paramError)
      return NextResponse.json({ error: 'Bad Request: Invalid route parameters' }, { status: 400 })
    }

    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      return NextResponse.json({ error: 'Bad Request: Match code is required' }, { status: 400 })
    }

    // Parse request body
    let body
    try {
      body = await request.json()
    } catch (parseError) {
      console.error('[v0] Failed to parse request body:', parseError)
      return NextResponse.json({ error: 'Bad Request: Invalid JSON body' }, { status: 400 })
    }

    const { player_id, player_name, agent_id, agent_name } = body

    // Validate required fields
    if (!player_id || typeof player_id !== 'string' || player_id.trim().length === 0) {
      return NextResponse.json(
        { error: 'Bad Request: player_id is required and must be a non-empty string' },
        { status: 400 }
      )
    }

    if (!player_name || typeof player_name !== 'string' || player_name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Bad Request: player_name is required and must be a non-empty string' },
        { status: 400 }
      )
    }

    if (player_name.length > 255) {
      return NextResponse.json(
        { error: 'Bad Request: player_name must be less than 255 characters' },
        { status: 400 }
      )
    }

    if (!agent_id || typeof agent_id !== 'string' || agent_id.trim().length === 0) {
      return NextResponse.json(
        { error: 'Bad Request: agent_id is required and must be a non-empty string' },
        { status: 400 }
      )
    }

    if (!agent_name || typeof agent_name !== 'string' || agent_name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Bad Request: agent_name is required and must be a non-empty string' },
        { status: 400 }
      )
    }

    // Get match
    const { data: match, error: matchError } = await supabaseAdmin
      .from('matches')
      .select('*')
      .eq('code', code.toUpperCase())
      .single()

    if (matchError && matchError.code !== 'PGRST116') {
      console.error('[v0] Database error fetching match:', matchError)
      return NextResponse.json(
        { error: 'Internal Server Error: Failed to fetch match' },
        { status: 500 }
      )
    }

    if (!match || matchError?.code === 'PGRST116') {
      return NextResponse.json(
        { error: 'Not Found: Match with this code does not exist' },
        { status: 404 }
      )
    }

    if (!match.id) {
      console.error('[v0] Match object missing id field:', match)
      return NextResponse.json(
        { error: 'Internal Server Error: Invalid match object' },
        { status: 500 }
      )
    }

    // Check if player already in match
    const { data: existingPlayer, error: existingPlayerError } = await supabaseAdmin
      .from('match_players')
      .select('*')
      .eq('match_id', match.id)
      .eq('player_id', player_id)
      .single()

    if (existingPlayerError && existingPlayerError.code !== 'PGRST116') {
      console.error('[v0] Database error checking for existing player:', existingPlayerError)
      return NextResponse.json(
        { error: 'Internal Server Error: Failed to check player status' },
        { status: 500 }
      )
    }

    if (existingPlayer) {
      return NextResponse.json(
        { error: 'Bad Request: Player already in this match' },
        { status: 400 }
      )
    }

    // Check max players
    const { data: players, error: playersError } = await supabaseAdmin
      .from('match_players')
      .select('id')
      .eq('match_id', match.id)

    if (playersError) {
      console.error('[v0] Database error fetching players:', playersError)
      return NextResponse.json(
        { error: 'Internal Server Error: Failed to fetch player count' },
        { status: 500 }
      )
    }

    // Allow anyone to join, creators can join anytime

    if (!Number.isInteger(match.max_players) || match.max_players < 2) {
      console.error('[v0] Invalid match.max_players:', match.max_players)
      return NextResponse.json(
        { error: 'Internal Server Error: Invalid match configuration' },
        { status: 500 }
      )
    }

    if (players && players.length >= match.max_players) {
      return NextResponse.json(
        { error: 'Conflict: Match is full' },
        { status: 409 }
      )
    }

    // Get match purse setting from first player (created with match)
    const { data: firstPlayer, error: purseError } = await supabaseAdmin
      .from('match_players')
      .select('initial_purse')
      .eq('match_id', match.id)
      .limit(1)
      .single()

    if (purseError && purseError.code !== 'PGRST116') {
      console.error('[v0] Database error fetching purse:', purseError)
      return NextResponse.json(
        { error: 'Internal Server Error: Failed to fetch match purse' },
        { status: 500 }
      )
    }

    const purseAmount = firstPlayer?.initial_purse || 1000

    if (!Number.isInteger(purseAmount) || purseAmount < 100) {
      console.error('[v0] Invalid purse amount:', purseAmount)
      return NextResponse.json(
        { error: 'Internal Server Error: Invalid match purse' },
        { status: 500 }
      )
    }

    // Add player to match with agent
    const playerData = {
      match_id: match.id,
      player_id,
      player_name,
      agent_id,
      agent_name,
      purse: purseAmount,
      initial_purse: purseAmount,
      pnl: 0,
    }
    
    console.log('[v0] Attempting to add player to match:', playerData)
    
    const { data: newPlayer, error: insertError } = await supabaseAdmin
      .from('match_players')
      .insert([playerData])
      .select()

    if (insertError) {
      console.error('[v0] Failed to add player to database:', insertError)
      return NextResponse.json(
        { error: 'Failed to join match: ' + insertError.message },
        { status: 500 }
      )
    }

    console.log('[v0] Successfully added player:', newPlayer)

    return NextResponse.json(
      { player: newPlayer?.[0] },
      { status: 201 }
    )
  } catch (error) {
    console.error('[v0] Error in POST /api/matches/[code]:', error)
    return NextResponse.json({ error: 'Failed to join match' }, { status: 500 })
  }
}

// Update match status (e.g. start the match for everyone)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: 'Supabase not configured' },
      { status: 500 }
    )
  }

  try {
    let code: string
    try {
      ({ code } = await params)
    } catch (paramError) {
      console.error('[v0] Failed to parse route params:', paramError)
      return NextResponse.json({ error: 'Bad Request: Invalid route parameters' }, { status: 400 })
    }

    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      return NextResponse.json({ error: 'Bad Request: Match code is required' }, { status: 400 })
    }

    let body
    try {
      body = await request.json()
    } catch (parseError) {
      console.error('[v0] Failed to parse request body:', parseError)
      return NextResponse.json({ error: 'Bad Request: Invalid JSON body' }, { status: 400 })
    }

    const { status } = body
    const allowedStatuses = ['pending', 'active', 'completed']

    if (!status || !allowedStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Bad Request: status must be one of ${allowedStatuses.join(', ')}` },
        { status: 400 }
      )
    }

    const { data: match, error: matchError } = await supabaseAdmin
      .from('matches')
      .select('*')
      .eq('code', code.toUpperCase())
      .single()

    if (matchError && matchError.code !== 'PGRST116') {
      console.error('[v0] Database error fetching match:', matchError)
      return NextResponse.json(
        { error: 'Internal Server Error: Failed to fetch match' },
        { status: 500 }
      )
    }

    if (!match || matchError?.code === 'PGRST116') {
      return NextResponse.json(
        { error: 'Not Found: Match with this code does not exist' },
        { status: 404 }
      )
    }

    const { data: updatedMatch, error: updateError } = await supabaseAdmin
      .from('matches')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', match.id)
      .select()
      .single()

    if (updateError) {
      console.error('[v0] Database error updating match status:', updateError)
      return NextResponse.json(
        { error: 'Internal Server Error: Failed to update match status' },
        { status: 500 }
      )
    }

    return NextResponse.json({ match: updatedMatch }, { status: 200 })
  } catch (error) {
    console.error('[v0] Error in PATCH /api/matches/[code]:', error)
    return NextResponse.json({ error: 'Internal Server Error: Failed to update match' }, { status: 500 })
  }
}

// Delete a match
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: 'Supabase not configured' },
      { status: 500 }
    )
  }

  try {
    // The 'code' param is actually the match ID when called from frontend
    // Parse userId from request body for demo mode authorization
    let userId: string
    try {
      const body = await request.json()
      userId = body.userId
    } catch {
      return NextResponse.json({ error: 'Bad Request: userId required in body' }, { status: 400 })
    }

    if (!userId) {
      return NextResponse.json({ error: 'Bad Request: userId is required' }, { status: 400 })
    }
    let matchId: string
    try {
      ({ code: matchId } = await params)
    } catch (paramError) {
      console.error('[v0] Failed to parse route params:', paramError)
      return NextResponse.json({ error: 'Bad Request: Invalid route parameters' }, { status: 400 })
    }

    if (!matchId || typeof matchId !== 'string' || matchId.trim().length === 0) {
      return NextResponse.json({ error: 'Bad Request: Match ID is required' }, { status: 400 })
    }

    // Get the match to verify user is the creator
    const { data: match, error: matchError } = await supabaseAdmin
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single()

    if (matchError && matchError.code !== 'PGRST116') {
      console.error('[v0] Database error fetching match:', matchError)
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }

    if (!match || matchError?.code === 'PGRST116') {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 })
    }

    // Verify user is the creator
    if (match.creator_id !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Delete all match_players first (due to foreign key constraint)
    const { error: playerError } = await supabaseAdmin
      .from('match_players')
      .delete()
      .eq('match_id', matchId)

    if (playerError) {
      console.error('[v0] Error deleting match_players:', playerError)
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }

    // Delete the match
    const { error: deleteError } = await supabaseAdmin
      .from('matches')
      .delete()
      .eq('id', matchId)

    if (deleteError) {
      console.error('[v0] Error deleting match:', deleteError)
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    console.error('[v0] Error in DELETE /api/matches/[code]:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
