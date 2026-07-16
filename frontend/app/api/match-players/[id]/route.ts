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
