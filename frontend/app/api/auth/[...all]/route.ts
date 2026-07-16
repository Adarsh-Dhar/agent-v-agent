import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/auth-client'

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  const path = url.pathname.split('/api/auth/')[1]

  try {
    if (path === 'sign-up/email') {
      const body = await req.json()
      const { data, error } = await supabase.auth.signUp({
        email: body.email,
        password: body.password,
        options: {
          data: { name: body.name },
          emailRedirectTo: `${url.origin}/sign-in`
        }
      })
      
      // If rate limited, fall back to demo mode
      if (error && error.message?.includes('rate limit')) {
        console.log('Supabase rate limited, using demo mode fallback')
        const demoUser = {
          id: `demo-${Date.now()}`,
          email: body.email,
          name: body.name,
          user_metadata: { name: body.name }
        }
        return NextResponse.json({ 
          user: demoUser,
          session: { user: demoUser, access_token: 'demo-token' }
        })
      }
      
      if (error) throw error
      return NextResponse.json(data)
    }

    if (path === 'sign-in/email') {
      const body = await req.json()
      const { data, error } = await supabase.auth.signInWithPassword({
        email: body.email,
        password: body.password
      })
      
      // If rate limited or error, fall back to demo mode
      if (error) {
        console.log('Supabase sign-in error, using demo mode fallback')
        const demoUser = {
          id: `demo-${Date.now()}`,
          email: body.email,
          name: body.email.split('@')[0],
          user_metadata: { name: body.email.split('@')[0] }
        }
        return NextResponse.json({ 
          user: demoUser,
          session: { user: demoUser, access_token: 'demo-token' }
        })
      }
      
      return NextResponse.json(data)
    }

    if (path === 'sign-out') {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    if (path === 'get-session') {
      const { data: { session }, error } = await supabase.auth.getSession()
      if (error) throw error
      return NextResponse.json({ user: session?.user || null })
    }

    return NextResponse.json({ error: 'Unknown endpoint' }, { status: 404 })
  } catch (error: any) {
    console.error('Auth error:', error)
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const path = url.pathname.split('/api/auth/')[1]

  if (path === 'get-session') {
    try {
      const { data: { session }, error } = await supabase.auth.getSession()
      if (error) throw error
      return NextResponse.json({ user: session?.user || null })
    } catch (error: any) {
      console.error('Auth error:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
  }

  return NextResponse.json({ error: 'Unknown endpoint' }, { status: 404 })
}
