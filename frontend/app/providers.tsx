'use client'

import { ReactNode, createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '@/lib/auth-client'

interface User {
  id: string
  email?: string
  name?: string
}

interface Player {
  id: string
  name: string
  total_trades?: number
  total_pnl?: number
  win_rate?: number
}

interface AuthContextType {
  user: User | null
  player: Player | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [player, setPlayer] = useState<Player | null>(null)
  const [loading, setLoading] = useState(true)
  const [authVersion, setAuthVersion] = useState(0)

  useEffect(() => {
    // Check for demo mode from localStorage first
    const loadFromStorage = () => {
      const demoUser = localStorage.getItem('demo_user')
      const demoPlayer = localStorage.getItem('demo_player')
      
      console.log('[AuthProvider] loadFromStorage called', { demoUser, demoPlayer })
      
      if (demoUser && demoPlayer) {
        const parsedUser = JSON.parse(demoUser)
        const parsedPlayer = JSON.parse(demoPlayer)
        console.log('[AuthProvider] Loading from storage', { parsedUser, parsedPlayer })
        setUser(parsedUser)
        setPlayer(parsedPlayer)
        setLoading(false)
        return true
      } else {
        console.log('[AuthProvider] No storage data found')
        setUser(null)
        setPlayer(null)
        setLoading(false)
        return false
      }
    }

    // Initial load
    loadFromStorage()

    // Listen for custom auth state change events (for demo mode)
    const handleAuthChange = () => {
      console.log('[AuthProvider] auth-state-change event received')
      loadFromStorage()
    }

    window.addEventListener('auth-state-change', handleAuthChange)

    // Also listen for storage changes (for cross-tab sync)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'demo_user' || e.key === 'demo_player') {
        console.log('[AuthProvider] storage change detected', e.key)
        loadFromStorage()
      }
    }

    window.addEventListener('storage', handleStorageChange)

    return () => {
      window.removeEventListener('auth-state-change', handleAuthChange)
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [])

  const signOut = async () => {
    localStorage.removeItem('demo_user')
    localStorage.removeItem('demo_player')
    await supabase.auth.signOut()
    setUser(null)
    setPlayer(null)
  }

  return (
    <AuthContext.Provider value={{ user, player, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
