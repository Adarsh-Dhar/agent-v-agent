import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Use service role key for all operations
const supabaseAdmin = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey)
  : null

// Generate unique match code
function generateMatchCode(): string {
  return Math.random().toString(36).substring(2, 14).toUpperCase()
}

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

    if (!userId) {
      return NextResponse.json({ matches: [] }, { status: 200 })
    }

    // Get all matches where the user is a member (via match_players join)
    const { data, error } = await supabaseAdmin
      .from('match_players')
      .select(`
        match_id,
        matches:match_id (*)
      `)
      .eq('player_id', userId)

    if (error) {
      console.error('[v0] Supabase error fetching matches:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // Extract unique matches and sort by created_at
    const matchesMap = new Map()
    if (data) {
      data.forEach((item: any) => {
        if (item.matches && item.matches.id) {
          matchesMap.set(item.matches.id, item.matches)
        }
      })
    }

    const matches = Array.from(matchesMap.values())
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return NextResponse.json({ matches }, { status: 200 })
  } catch (error) {
    console.error('[v0] Error in GET /api/matches:', error)
    return NextResponse.json({ error: 'Failed to fetch matches' }, { status: 500 })
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
    let body
    try {
      body = await request.json()
    } catch (parseError) {
      return NextResponse.json(
        { error: 'Bad Request: Invalid JSON body' },
        { status: 400 }
      )
    }

    const { title, description, max_players = 4, initial_purse = 1000, creator_agent_id, creator_agent_name, userId, creatorName } = body

    // Validate required fields
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json(
        { error: 'Bad Request: Title is required and must be a non-empty string' },
        { status: 400 }
      )
    }

    if (title.length > 255) {
      return NextResponse.json(
        { error: 'Bad Request: Title must be less than 255 characters' },
        { status: 400 }
      )
    }

    if (description && typeof description !== 'string') {
      return NextResponse.json(
        { error: 'Bad Request: Description must be a string' },
        { status: 400 }
      )
    }

    if (!Number.isInteger(max_players) || max_players < 2 || max_players > 100) {
      return NextResponse.json(
        { error: 'Bad Request: Max players must be an integer between 2 and 100' },
        { status: 400 }
      )
    }

    if (!Number.isInteger(initial_purse) || initial_purse < 100 || initial_purse > 1000000) {
      return NextResponse.json(
        { error: 'Bad Request: Initial purse must be between 100 and 1,000,000' },
        { status: 400 }
      )
    }

    if (!creator_agent_id || typeof creator_agent_id !== 'string' || creator_agent_id.trim().length === 0) {
      return NextResponse.json(
        { error: 'Bad Request: Creator must select a valid agent' },
        { status: 400 }
      )
    }

    if (!creator_agent_name || typeof creator_agent_name !== 'string' || creator_agent_name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Bad Request: Agent name is required' },
        { status: 400 }
      )
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'Bad Request: User ID is required' },
        { status: 400 }
      )
    }

    // Verify that the selected agent belongs to the creator
    const { data: agentData, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('id, owner')
      .eq('id', creator_agent_id)
      .single()

    if (agentError || !agentData) {
      return NextResponse.json(
        { error: 'Bad Request: Selected agent not found' },
        { status: 400 }
      )
    }

    if (agentData.owner !== userId) {
      return NextResponse.json(
        { error: 'Forbidden: You can only use agents that you own' },
        { status: 403 }
      )
    }

    const code = generateMatchCode()

    // Insert match
    const { data, error } = await supabaseAdmin
      .from('matches')
      .insert([
        {
          code,
          title,
          description,
          creator_id: userId || 'demo-user-Demo User',
          creator_name: creatorName || 'Demo User',
          status: 'pending',
          max_players,
        },
      ])
      .select()

    if (error) {
      console.error('[v0] Database error creating match:', error)
      return NextResponse.json(
        { error: 'Internal Server Error: Failed to create match' },
        { status: 500 }
      )
    }

    if (!data || data.length === 0) {
      console.error('[v0] Match creation returned no data')
      return NextResponse.json(
        { error: 'Internal Server Error: Match creation failed' },
        { status: 500 }
      )
    }

    const match = data[0]

    if (!match.id || !match.code) {
      console.error('[v0] Invalid match object:', match)
      return NextResponse.json(
        { error: 'Internal Server Error: Invalid match object' },
        { status: 500 }
      )
    }

    // Add creator as first player
    const creatorPlayer = {
      match_id: match.id,
      player_id: userId || 'demo-user-Demo User',
      player_name: creatorName || 'Demo User',
      agent_id: creator_agent_id,
      agent_name: creator_agent_name,
      purse: initial_purse,
      initial_purse: initial_purse,
      pnl: 0,
    }

    const { data: creatorInserted, error: creatorError } = await supabaseAdmin
      .from('match_players')
      .insert([creatorPlayer])
      .select()

    if (creatorError) {
      console.warn('[v0] Warning: Could not add creator as player:', creatorError.message)
      // Don't fail the match creation if player insert fails
    } else {
      console.log('[v0] Creator added as player successfully')
    }

    return NextResponse.json(
      { match, code: match.code },
      { status: 201 }
    )
  } catch (error) {
    console.error('[v0] Error in POST /api/matches:', error)
    return NextResponse.json({ error: 'Failed to create match' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: 'Supabase not configured' },
      { status: 500 }
    )
  }

  try {
    // Delete all match_players first (due to foreign key constraint)
    const { error: playerError } = await supabaseAdmin
      .from('match_players')
      .delete()
      .not('id', 'is', null)

    if (playerError) {
      console.error('[v0] Error deleting match_players:', playerError)
    }

    // Delete all matches
    const { error: matchError } = await supabaseAdmin
      .from('matches')
      .delete()
      .not('id', 'is', null)

    if (matchError) {
      console.error('[v0] Error deleting matches:', matchError)
      return NextResponse.json(
        { error: 'Failed to delete matches', details: matchError },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { message: 'All matches and players deleted successfully' },
      { status: 200 }
    )
  } catch (error) {
    console.error('[v0] Error in DELETE /api/matches:', error)
    return NextResponse.json({ error: 'Failed to delete matches' }, { status: 500 })
  }
}
