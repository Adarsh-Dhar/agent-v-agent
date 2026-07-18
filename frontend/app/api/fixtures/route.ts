import { NextResponse } from 'next/server'

const SERVER_URL = process.env.AGENT_SERVER_URL || process.env.SERVER_URL || 'http://localhost:5000'

export async function GET() {
  try {
    const res = await fetch(`${SERVER_URL}/fixtures`, {
      cache: 'no-store',
    })
    
    if (!res.ok) {
      console.error('[v0] Server returned non-OK status:', res.status, res.statusText)
      const text = await res.text()
      console.error('[v0] Response body:', text)
      return NextResponse.json({ fixtures: [], error: `Server error: ${res.status}` }, { status: res.status })
    }
    
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    console.error('[v0] Error fetching fixtures:', err)
    return NextResponse.json({ fixtures: [], error: 'Failed to fetch fixtures' }, { status: 502 })
  }
}
