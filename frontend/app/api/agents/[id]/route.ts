import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Use anon key for reads (GET)
const supabaseClient = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

// Use service role key for writes (PUT, DELETE) - bypasses RLS
const supabaseAdmin = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey)
  : null

export async function GET(
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

    // Use admin client for GET to bypass RLS
    const { data, error } = await supabaseAdmin
      .from('agents')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      console.error('[v0] Supabase error fetching agent:', error)
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ agent: data }, { status: 200 })
  } catch (error) {
    console.error('[v0] Error in GET /api/agents/[id]:', error)
    return NextResponse.json(
      { error: 'Failed to fetch agent' },
      { status: 500 }
    )
  }
}

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

    // Use admin client for UPDATE to bypass RLS
    const { data, error } = await supabaseAdmin
      .from('agents')
      .update(body)
      .eq('id', id)
      .select()

    if (error) {
      console.error('[v0] Supabase error updating agent:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json(
      { agent: data?.[0], message: 'Agent updated successfully' },
      { status: 200 }
    )
  } catch (error) {
    console.error('[v0] Error in PUT /api/agents/[id]:', error)
    return NextResponse.json(
      { error: 'Failed to update agent' },
      { status: 500 }
    )
  }
}

export async function DELETE(
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

    // Use admin client for DELETE to bypass RLS
    const { error } = await supabaseAdmin
      .from('agents')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('[v0] Supabase error deleting agent:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json(
      { message: 'Agent deleted successfully' },
      { status: 200 }
    )
  } catch (error) {
    console.error('[v0] Error in DELETE /api/agents/[id]:', error)
    return NextResponse.json(
      { error: 'Failed to delete agent' },
      { status: 500 }
    )
  }
}
