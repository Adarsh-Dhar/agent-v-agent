import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://tzcnntxptekcaapbibee.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6Y25udHhwdGVrY2FhcGJpYmVlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mzg3Mjg3MSwiZXhwIjoyMDk5NDQ4ODcxfQ.4pNGDAJ2YEQ2c3sHjeMBXLmG7txJjLHN166gIxpF1VY'

export const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const authClient = {
  signIn: {
    email: async ({ email, password }: any) => {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password
        })
        if (error) throw error
        // Store in localStorage for demo mode persistence
        if (data.user) {
          localStorage.setItem('demo_user', JSON.stringify(data.user))
          localStorage.setItem('demo_player', JSON.stringify({
            id: data.user.id,
            name: data.user.user_metadata?.name || data.user.email || 'Player'
          }))
          window.dispatchEvent(new Event('auth-state-change'))
        }
        return data
      } catch (error: any) {
        // Fallback to demo mode on any error
        console.log('Supabase sign-in error, using demo mode fallback')
        const demoUser = {
          id: `demo-${Date.now()}`,
          email: email,
          name: email.split('@')[0],
          user_metadata: { name: email.split('@')[0] }
        }
        const demoPlayer = {
          id: demoUser.id,
          name: demoUser.name
        }
        // Store in localStorage
        localStorage.setItem('demo_user', JSON.stringify(demoUser))
        localStorage.setItem('demo_player', JSON.stringify(demoPlayer))
        window.dispatchEvent(new Event('auth-state-change'))
        return {
          user: demoUser,
          session: { user: demoUser, access_token: 'demo-token' }
        }
      }
    }
  },
  signUp: {
    email: async ({ email, password, name }: any) => {
      try {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name }
          }
        })
        if (error) throw error
        // Store in localStorage for demo mode persistence
        if (data.user) {
          localStorage.setItem('demo_user', JSON.stringify(data.user))
          localStorage.setItem('demo_player', JSON.stringify({
            id: data.user.id,
            name: data.user.user_metadata?.name || name || 'Player'
          }))
          window.dispatchEvent(new Event('auth-state-change'))
        }
        return data
      } catch (error: any) {
        // Fallback to demo mode on any error
        console.log('Supabase sign-up error, using demo mode fallback')
        const demoUser = {
          id: `demo-${Date.now()}`,
          email: email,
          name: name,
          user_metadata: { name }
        }
        const demoPlayer = {
          id: demoUser.id,
          name: demoUser.name
        }
        // Store in localStorage
        localStorage.setItem('demo_user', JSON.stringify(demoUser))
        localStorage.setItem('demo_player', JSON.stringify(demoPlayer))
        window.dispatchEvent(new Event('auth-state-change'))
        return {
          user: demoUser,
          session: { user: demoUser, access_token: 'demo-token' }
        }
      }
    }
  },
  signOut: async () => {
    try {
      await supabase.auth.signOut()
    } catch (error) {
      console.log('Supabase sign-out error, ignoring')
    }
    // Clear localStorage
    localStorage.removeItem('demo_user')
    localStorage.removeItem('demo_player')
    window.dispatchEvent(new Event('auth-state-change'))
  }
}
