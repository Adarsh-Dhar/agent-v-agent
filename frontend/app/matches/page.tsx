'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Header from '@/components/header'
import { Plus, Copy, Loader, Trash2 } from 'lucide-react'
import { useAuth } from '@/app/providers'
import type { Match } from '@/lib/supabase'

export default function MatchesPage() {
  const { user } = useAuth()
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [joinCode, setJoinCode] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)
  const [joiningMatch, setJoiningMatch] = useState(false)

  const fetchMatches = useCallback(async () => {
    try {
      setLoading(true)
      const url = new URL('/api/matches', window.location.origin)
      if (user?.id) {
        url.searchParams.append('userId', user.id)
      }
      
      const response = await fetch(url.toString())
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch matches')
      }

      setMatches(data.matches || [])
      setError(null)
    } catch (err) {
      console.error('[v0] Error fetching matches:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch matches')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    fetchMatches()
  }, [fetchMatches])

  const copyCode = (code: string) => {
    const fallbackCopy = () => {
      try {
        const textArea = document.createElement('textarea')
        textArea.value = code
        textArea.style.position = 'fixed'
        textArea.style.left = '-999999px'
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      } catch (err) {
        console.error('[v0] Fallback copy failed:', err)
      }
    }
    
    // Try modern Clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(code).catch(() => {
        // If clipboard API fails, use fallback
        fallbackCopy()
      })
    } else {
      // Use fallback immediately for insecure contexts
      fallbackCopy()
    }
    
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  const deleteMatch = async (matchId: string) => {
    if (!confirm('Are you sure you want to delete this match?')) return

    setDeletingId(matchId)
    try {
      const response = await fetch(`/api/matches/${matchId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user?.id,
        }),
      })

      if (!response.ok) {
        // Try to parse error response, but handle cases where response is empty
        let errorMessage = 'Failed to delete match'
        try {
          const contentType = response.headers.get('content-type')
          if (contentType && contentType.includes('application/json')) {
            const data = await response.json()
            errorMessage = data.error || errorMessage
          }
        } catch (parseErr) {
          console.error('[v0] Could not parse error response:', parseErr)
        }
        throw new Error(errorMessage)
      }

      setMatches(matches.filter(m => m.id !== matchId))
    } catch (err) {
      console.error('[v0] Error deleting match:', err)
      alert(err instanceof Error ? err.message : 'Failed to delete match')
    } finally {
      setDeletingId(null)
    }
  }

  const handleJoinMatch = async (e: React.FormEvent) => {
    e.preventDefault()
    setJoinError(null)

    if (!joinCode.trim()) {
      setJoinError('Please enter a match code')
      return
    }

    setJoiningMatch(true)
    try {
      const response = await fetch(`/api/matches/${joinCode.toUpperCase()}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Match not found')
      }

      // Successfully found match, redirect using the actual match code (not secret_code)
      window.location.href = `/matches/${data.match.code}`
    } catch (err) {
      console.error('[v0] Error joining match:', err)
      setJoinError(err instanceof Error ? err.message : 'Failed to join match')
    } finally {
      setJoiningMatch(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8">
        {/* Join Match Section */}
        <div className="mb-8 p-6 glass-card">
          <h2 className="text-xl font-bold text-foreground mb-4">Join a Match</h2>
          <form onSubmit={handleJoinMatch} className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Enter match code or secret code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              disabled={joiningMatch}
              maxLength={32}
              className="flex-1 px-4 py-3 bg-input/50 border border-border/50 rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 font-mono text-lg tracking-wider"
            />
            <button
              type="submit"
              disabled={joiningMatch}
              className="px-6 py-3 bg-gradient-to-r from-primary to-secondary text-background rounded-lg font-medium hover:shadow-lg hover:shadow-primary/50 transition-all disabled:opacity-50"
            >
              {joiningMatch ? 'Joining...' : 'Join Match'}
            </button>
          </form>
          {joinError && (
            <p className="mt-3 text-sm text-destructive">{joinError}</p>
          )}
        </div>

        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold gradient-text">My Matches</h1>
            <p className="text-muted-foreground mt-2">Create a match and share the code with your peers</p>
          </div>
          <Link
            href="/matches/create"
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-primary to-secondary text-background rounded-lg font-medium hover:shadow-lg hover:shadow-primary/50 transition-all"
          >
            <Plus className="w-5 h-5" />
            Create Match
          </Link>
        </div>

        {/* Error State */}
        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive rounded-lg text-destructive">
            {error}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && matches.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 min-h-[400px] glass-card">
            <Trash2 className="w-16 h-16 text-muted-foreground mb-4 opacity-50" />
            <h2 className="text-2xl font-bold text-foreground mb-2">No matches yet</h2>
            <p className="text-muted-foreground mb-6 max-w-md text-center">
              Create a match and invite your friends using the secret code.
            </p>
            <Link
              href="/matches/create"
              className="px-6 py-3 bg-gradient-to-r from-primary to-secondary text-background rounded-lg font-medium hover:shadow-lg hover:shadow-primary/50 transition-all"
            >
              Create Your First Match
            </Link>
          </div>
        )}

        {/* Matches Grid */}
        {!loading && !error && matches.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {matches.map((match) => (
              <Link
                key={match.id}
                href={`/matches/${match.code}`}
                className="group glass-card p-6 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/20 transition-all flex flex-col"
              >
                <div className="space-y-4 flex-1">
                  <div>
                    <h3 className="text-lg font-bold text-foreground mb-1 line-clamp-2">{match.title}</h3>
                    <p className="text-sm text-muted-foreground line-clamp-2">{match.description}</p>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-border">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      match.status === 'active'
                        ? 'bg-accent/20 text-accent'
                        : match.status === 'completed'
                        ? 'bg-muted text-muted-foreground'
                        : 'bg-secondary/20 text-secondary'
                    }`}>
                      {match.status.charAt(0).toUpperCase() + match.status.slice(1)}
                    </span>
                  </div>
                </div>

                {/* Match Code Section */}
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-2">Secret Code</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-3 py-3 bg-muted rounded-lg text-lg font-mono font-bold text-foreground tracking-wider text-center">
                      {match.code}
                    </div>
                    <button
                      onClick={(e) => {
                        e.preventDefault()
                        copyCode(match.code)
                      }}
                      className="p-2 text-primary hover:bg-primary/10 rounded transition-colors flex-shrink-0"
                      title="Copy match code"
                    >
                      {copiedCode === match.code ? (
                        <span className="text-xs font-bold">✓</span>
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      onClick={(e) => {
                        e.preventDefault()
                        deleteMatch(match.id)
                      }}
                      disabled={deletingId === match.id}
                      className="p-2 text-destructive hover:bg-destructive/10 rounded transition-colors disabled:opacity-50 flex-shrink-0"
                      title="Delete match"
                    >
                      {deletingId === match.id ? (
                        <Loader className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
