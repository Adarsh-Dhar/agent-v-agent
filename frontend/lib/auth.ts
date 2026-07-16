import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://tzcnntxptekcaapbibee.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6Y25udHhwdGVrY2FhcGJpYmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NzI4NzEsImV4cCI6MjA5OTQ0ODg3MX0.4pNGDAJ2YEQ2c3sHjeMBXLmG7txJjLHN166gIxpF1VY'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export const auth = {
  api: {
    getSession: async (headers: any) => {
      const cookie = typeof headers?.get === 'function' 
        ? headers.get('cookie') 
        : headers?.cookie
      const token = cookie?.match(/sb-access-token=([^;]+)/)?.[1]
      if (!token) return null
      const { data: { user }, error } = await supabase.auth.getUser(token)
      if (error) return null
      return { user }
    },
    signUp: {
      email: async ({ email, password, name }: any) => {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name }
          }
        })
        if (error) throw error
        return data
      }
    },
    signIn: {
      email: async ({ email, password }: any) => {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password
        })
        if (error) throw error
        return data
      }
    },
    signOut: async () => {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    }
  }
}
