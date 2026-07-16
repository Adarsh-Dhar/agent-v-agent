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
    const { pnl_change } = body

    if (pnl_change === undefined) {
      return NextResponse.json(
        { error: 'pnl_change is required' },
        { status: 400 }
      )
    }

    // Get current player data
    const { data: player, error: fetchError } = await supabaseAdmin
      .from('match_players')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !player) {
      return NextResponse.json(
        { error: 'Player not found' },
        { status: 404 }
      )
    }

    // Update purse and PnL
    const new_purse = player.purse + pnl_change
    const new_pnl = player.pnl + pnl_change

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('match_players')
      .update({
        purse: new_purse,
        pnl: new_pnl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()

    if (updateError) {
      console.error('[v0] Error updating purse:', updateError)
      return NextResponse.json({ error: updateError.message }, { status: 400 })
    }

    return NextResponse.json(
      {
        player: updated?.[0],
        message: 'Purse updated successfully',
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('[v0] Error in PUT /api/match-players/[id]/purse:', error)
    return NextResponse.json(
      { error: 'Failed to update purse' },
      { status: 500 }
    )
  }
}
