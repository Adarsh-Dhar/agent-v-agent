import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey)
  : null

export async function POST() {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: 'Supabase not configured' },
      { status: 500 }
    )
  }

  try {
    // Delete all agents by truncating the table
    const result = await supabaseAdmin.rpc('truncate_agents_table')

    if (result.error) {
      console.error('[v0] Error deleting agents:', result.error)
      // Fallback: delete records one by one
      const { data: allAgents } = await supabaseAdmin.from('agents').select('id')
      if (allAgents && allAgents.length > 0) {
        for (const agent of allAgents) {
          await supabaseAdmin.from('agents').delete().eq('id', agent.id)
        }
      }
    }

    return NextResponse.json({ message: 'All agents deleted successfully' }, { status: 200 })
  } catch (err) {
    console.error('[v0] Error in DELETE agents:', err)
    return NextResponse.json({ error: 'Failed to delete agents' }, { status: 500 })
  }
}
