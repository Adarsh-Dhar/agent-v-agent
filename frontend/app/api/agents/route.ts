import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Use anon key for reads (GET)
const supabaseClient = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

// Use service role key for writes (POST, PUT, DELETE) - bypasses RLS
const supabaseAdmin = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey)
  : null

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

    // Build query
    let query = supabaseAdmin.from('agents').select('*')

    // Filter by owner if userId provided
    if (userId) {
      query = query.eq('owner', userId)
    }

    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) {
      console.error('[v0] Supabase error fetching agents:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ agents: data || [] }, { status: 200 })
  } catch (error) {
    console.error('[v0] Error in GET /api/agents:', error)
    return NextResponse.json(
      { error: 'Failed to fetch agents' },
      { status: 500 }
    )
  }
}

// The Express agent server owns agent creation: it validates the full
// strategy config against the schema in server/src/lib/validateConfig.js
// and is what /agents/:id/run and the trading runner expect to exist.
// Keep this in an env var since it's an internal service URL, not a public one.
const AGENT_SERVER_URL = process.env.AGENT_SERVER_URL || 'http://localhost:5000'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { owner, config } = body

    if (!config?.name) {
      return NextResponse.json(
        { error: 'Agent name is required' },
        { status: 400 }
      )
    }

    if (!owner) {
      return NextResponse.json(
        { error: 'Owner is required' },
        { status: 400 }
      )
    }

    // Forward straight to the Express server's POST /agents, which validates
    // the config and inserts into Supabase with the service-role key itself.
    const upstream = await fetch(`${AGENT_SERVER_URL}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner, config }),
    })

    const data = await upstream.json()

    if (!upstream.ok) {
      console.error('[v0] Agent server error creating agent:', data)
      return NextResponse.json(
        { error: data.error || 'Failed to create agent' },
        { status: upstream.status }
      )
    }

    return NextResponse.json(
      { agent: data, message: data.message || 'Agent created successfully' },
      { status: 201 }
    )
  } catch (error) {
    console.error('[v0] Error in POST /api/agents:', error)
    return NextResponse.json(
      { error: 'Failed to create agent. Is the agent server running?' },
      { status: 500 }
    )
  }
}
