import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST() {
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

    // Initial games data
    const games = [
      {
        name: 'Argentina vs Switzerland',
        description: 'International Football Match',
        sport: 'football',
        team_a: 'Argentina',
        team_b: 'Switzerland',
        status: 'ongoing',
        start_time: new Date().toISOString(),
      },
      {
        name: 'India vs Pakistan',
        description: 'Cricket Test Match',
        sport: 'cricket',
        team_a: 'India',
        team_b: 'Pakistan',
        status: 'ongoing',
        start_time: new Date().toISOString(),
      },
      {
        name: 'Los Angeles Lakers vs Golden State Warriors',
        description: 'NBA Regular Season',
        sport: 'basketball',
        team_a: 'Los Angeles Lakers',
        team_b: 'Golden State Warriors',
        status: 'ongoing',
        start_time: new Date().toISOString(),
      },
      {
        name: 'England vs Australia',
        description: 'Rugby World Cup',
        sport: 'rugby',
        team_a: 'England',
        team_b: 'Australia',
        status: 'upcoming',
        start_time: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        name: 'France vs New Zealand',
        description: 'Rugby Union Test',
        sport: 'rugby',
        team_a: 'France',
        team_b: 'New Zealand',
        status: 'upcoming',
        start_time: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        name: 'Brazil vs Germany',
        description: 'International Football Friendly',
        sport: 'football',
        team_a: 'Brazil',
        team_b: 'Germany',
        status: 'upcoming',
        start_time: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]

    // Insert games
    const { data, error } = await supabaseAdmin
      .from('games')
      .insert(games)
      .select()

    if (error) {
      console.error('[v0] Error seeding games:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { 
        message: 'Games seeded successfully',
        count: data?.length || 0,
        games: data
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('[v0] Error in POST /api/setup-games:', error)
    return NextResponse.json(
      { error: 'Failed to seed games' },
      { status: 500 }
    )
  }
}
