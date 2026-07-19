import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey)
  : null

export async function GET() {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: 'Supabase not configured' },
      { status: 500 }
    )
  }

  try {
    // Fetch all match_players rows and aggregate by player_id
    const { data: rows, error } = await supabaseAdmin
      .from('match_players')
      .select('player_id, player_name, pnl, purse, initial_purse, match_id')

    if (error) {
      console.error('[v0] Leaderboard query failed:', error)
      return NextResponse.json(
        { error: 'Internal Server Error: Failed to fetch leaderboard' },
        { status: 500 }
      )
    }

    // Group by player_name (demo mode creates different player_ids per session)
    const testNames = /^(demo|test|alice|bob|charlie)/i

    const byName = new Map<string, {
      player_ids: Set<string>
      player_name: string
      total_pnl: number
      matches_played: number
      total_purse: number
      total_initial_purse: number
    }>()

    for (const r of rows || []) {
      if (/^\d+$/.test(r.player_id)) continue
      if (testNames.test(r.player_name || '')) continue

      const key = (r.player_name || '').trim().toLowerCase()
      if (!key) continue

      const existing = byName.get(key)
      if (existing) {
        existing.player_ids.add(r.player_id)
        existing.total_pnl += r.pnl ?? 0
        existing.matches_played += 1
        existing.total_purse += r.purse ?? 0
        existing.total_initial_purse += r.initial_purse ?? 0
      } else {
        byName.set(key, {
          player_ids: new Set([r.player_id]),
          player_name: r.player_name,
          total_pnl: r.pnl ?? 0,
          matches_played: 1,
          total_purse: r.purse ?? 0,
          total_initial_purse: r.initial_purse ?? 0,
        })
      }
    }

    const leaderboard = Array.from(byName.values())
      .map((p) => ({
        player_ids: Array.from(p.player_ids),
        player_name: p.player_name,
        total_pnl: p.total_pnl,
        matches_played: p.matches_played,
      }))
      .sort((a, b) => b.total_pnl - a.total_pnl)

    return NextResponse.json({ leaderboard }, { status: 200 })
  } catch (error) {
    console.error('[v0] Error in GET /api/leaderboard:', error)
    return NextResponse.json(
      { error: 'Internal Server Error: Failed to fetch leaderboard' },
      { status: 500 }
    )
  }
}
