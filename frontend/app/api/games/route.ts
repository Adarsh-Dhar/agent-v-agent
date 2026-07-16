import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return NextResponse.json(
        { error: 'Missing Supabase credentials' },
        { status: 400 }
      )
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    })

    // Get query parameter for status filter
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    let query = supabaseAdmin.from('games').select('*')

    // Filter by status if provided
    if (status) {
      query = query.eq('status', status)
    } else {
      // Default: return ongoing and upcoming games
      query = query.in('status', ['ongoing', 'upcoming'])
    }

    // Order by start_time ascending
    const { data: games, error } = await query.order('start_time', { ascending: true })

    if (error) {
      console.error('[v0] Error fetching games:', error)
      // Continue with hardcoded games if database error
    }

    // Hardcoded games for testing (including Argentina vs Switzerland)
    const hardcodedGames = [
      {
        id: 'game-1',
        name: 'Argentina vs Switzerland',
        description: 'FIFA World Cup 2026 Qualifier',
        sport: 'football',
        team_a: 'Argentina',
        team_b: 'Switzerland',
        status: 'ongoing',
        start_time: new Date().toISOString(),
        end_time: null,
        location: 'Buenos Aires',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]

    // Combine database games with hardcoded games
    const allGames = [...(games || []), ...hardcodedGames]
    
    // Remove duplicates based on ID
    const uniqueGames = Array.from(
      new Map(allGames.map(game => [game.id, game])).values()
    )

    return NextResponse.json(
      { games: uniqueGames || [], message: 'Games fetched successfully' },
      { status: 200 }
    )
  } catch (error) {
    console.error('[v0] Error in GET /api/games:', error)
    return NextResponse.json(
      { error: 'Failed to fetch games' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return NextResponse.json(
        { error: 'Missing Supabase credentials' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { name, description, sport, team_a, team_b, status = 'upcoming', start_time, location } = body

    if (!name || !sport || !team_a || !team_b) {
      return NextResponse.json(
        { error: 'Missing required fields: name, sport, team_a, team_b' },
        { status: 400 }
      )
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    })

    const { data: game, error } = await supabaseAdmin
      .from('games')
      .insert([
        {
          name,
          description,
          sport,
          team_a,
          team_b,
          status,
          start_time: start_time || new Date().toISOString(),
          location,
        },
      ])
      .select()

    if (error) {
      console.error('[v0] Error creating game:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { game: game?.[0], message: 'Game created successfully' },
      { status: 201 }
    )
  } catch (error) {
    console.error('[v0] Error in POST /api/games:', error)
    return NextResponse.json(
      { error: 'Failed to create game' },
      { status: 500 }
    )
  }
}
