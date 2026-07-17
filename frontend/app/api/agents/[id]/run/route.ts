import { NextRequest, NextResponse } from 'next/server'

const AGENT_SERVER_URL = process.env.AGENT_SERVER_URL || 'http://localhost:5000'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const upstream = await fetch(`${AGENT_SERVER_URL}/agents/${id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await upstream.json()

    if (!upstream.ok) {
      console.error('[v0] Agent server error starting run:', data)
      return NextResponse.json(
        { error: data.error || 'Failed to start agent run' },
        { status: upstream.status }
      )
    }

    return NextResponse.json(data, { status: upstream.status })
  } catch (error) {
    console.error('[v0] Error in POST /api/agents/[id]/run:', error)
    return NextResponse.json(
      { error: 'Failed to start agent run. Is the agent server running?' },
      { status: 500 }
    )
  }
}
