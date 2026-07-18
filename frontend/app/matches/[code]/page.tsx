'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Header from '@/components/header'
import { Copy, Plus, Loader, Users, Play } from 'lucide-react'
import { useAuth } from '@/app/providers'
import type { Match, MatchPlayer, Game } from '@/lib/supabase'

export default function MatchLobbyPage({ params }: { params: Promise<{ code: string }> | { code: string } }) {
  const router = useRouter()
  const { user } = useAuth()
  const [code, setCode] = useState<string>('')
  const [secretCode, setSecretCode] = useState<string>('')
  const [match, setMatch] = useState<Match | null>(null)
  const [game, setGame] = useState<Game | null>(null)
  const [players, setPlayers] = useState<MatchPlayer[]>([])
  const [agents, setAgents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [copied, setCopied] = useState(false)
  const [starting, setStarting] = useState(false)

  const matchStarted = match?.status === 'active' || match?.status === 'completed'

  const initCode = async () => {
    try {
      const resolvedParams = await Promise.resolve(params)
      if (resolvedParams && 'code' in resolvedParams) {
        setCode(resolvedParams.code.toUpperCase())
      }
    } catch (err) {
      console.error('[v0] Error resolving params:', err)
    }
  }

  useEffect(() => {
    initCode()
  }, [params])

  const fetchMatchData = useCallback(async () => {
    if (!code) return
    try {
      setLoading(true)
      const matchResponse = await fetch(`/api/matches/${code}`)
      const matchData = await matchResponse.json()
      if (!matchResponse.ok) throw new Error(matchData.error || 'Match not found')

      setMatch(matchData.match)
      setSecretCode(matchData.match?.secret_code || '')
      setPlayers(matchData.players || [])

      if (matchData.match?.game_id) {
        try {
          const gameResponse = await fetch(`/api/games/${matchData.match.game_id}`)
          if (gameResponse.ok) {
            const gameData = await gameResponse.json()
            setGame(gameData.game)
          }
        } catch (err) {
          console.error('[v0] Error fetching game:', err)
        }
      }

      const agentsUrl = new URL('/api/agents', window.location.origin)
      if (user?.id) agentsUrl.searchParams.append('userId', user.id)
      const agentsResponse = await fetch(agentsUrl.toString())
      const agentsData = await agentsResponse.json()
      if (agentsResponse.ok) setAgents(agentsData.agents || [])

      setError(null)
    } catch (err) {
      console.error('[v0] Error fetching match:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch match')
    } finally {
      setLoading(false)
    }
  }, [code, user])

  useEffect(() => {
    if (code) fetchMatchData()
  }, [code, fetchMatchData])

  // Redirect to /run once the match is active
  useEffect(() => {
    if (matchStarted && code) {
      router.replace(`/matches/${code}/run`)
    }
  }, [matchStarted, code, router])

  // Realtime subscriptions for lobby updates
  useEffect(() => {
    if (!code || matchStarted) return
    let matchSub: any = null
    let playersSub: any = null

    const setup = async () => {
      try {
        const { createClient } = await import('@supabase/supabase-js')
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        if (!supabaseUrl || !supabaseAnonKey) return

        const supabase = createClient(supabaseUrl, supabaseAnonKey)
        matchSub = supabase
          .channel(`match-${code}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `code=eq.${code}` }, (p: any) => {
            if (p.new) {
              setMatch(p.new as Match)
              setSecretCode(p.new.secret_code || '')
            }
          })
          .subscribe()

        playersSub = supabase
          .channel(`match-players-${code}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'match_players' }, () => {
            fetchMatchData()
          })
          .subscribe()
      } catch (err) {
        console.error('[v0] Error setting up realtime:', err)
      }
    }
    setup()
    return () => {
      if (matchSub) matchSub.unsubscribe()
      if (playersSub) playersSub.unsubscribe()
    }
  }, [code, matchStarted, fetchMatchData])

  const isPlayerInMatch = user && players.some(p => p.player_id === user.id)

  const startMatch = async () => {
    setStarting(true)
    try {
      const updateBody: any = { status: 'active' }
      if (match?.fixture_id) {
        updateBody.is_replay = match.is_replay ?? true
        updateBody.fixture_id = match.fixture_id
      }
      const response = await fetch(`/api/matches/${code}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateBody),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to start match')
      setMatch(data.match)
    } catch (err) {
      console.error('[v0] Error starting match:', err)
      alert(err instanceof Error ? err.message : 'Failed to start match')
    } finally {
      setStarting(false)
    }
  }

  const copyCode = () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(secretCode).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }).catch(() => {})
    }
  }

  const joinMatch = async () => {
    if (match && user && match.creator_id === user.id) {
      alert('You cannot join your own match')
      return
    }
    if (agents.length === 0) {
      alert('You must create an agent before joining a match')
      return
    }
    const agentSelect = prompt(
      'Select an agent to join the match. Agent IDs:\n' +
      agents.map((a, i) => `${i + 1}. ${a.name}`).join('\n') +
      '\n\nEnter the agent name:',
      agents[0]?.name || ''
    )
    if (!agentSelect) return
    const selectedAgent = agents.find(a => a.name === agentSelect)
    if (!selectedAgent) { alert('Agent not found'); return }

    setJoining(true)
    try {
      const response = await fetch(`/api/matches/${code}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_id: user?.id,
          player_name: user?.name || user?.email || 'Player',
          agent_id: selectedAgent.id,
          agent_name: selectedAgent.name,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to join match')
      await fetchMatchData()
    } catch (err) {
      console.error('[v0] Error joining match:', err)
      alert(err instanceof Error ? err.message : 'Failed to join match')
    } finally {
      setJoining(false)
    }
  }

  const selectAgent = async (playerId: string, agentId: string, agentName: string) => {
    try {
      const player = players.find(p => p.player_id === playerId)
      if (!player) return
      const response = await fetch(`/api/match-players/${player.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId, agent_name: agentName }),
      })
      if (!response.ok) throw new Error('Failed to select agent')
      await fetchMatchData()
    } catch (err) {
      console.error('[v0] Error selecting agent:', err)
      alert(err instanceof Error ? err.message : 'Failed to select agent')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="flex flex-col items-center justify-center py-20">
          <Loader className="w-8 h-8 text-primary animate-spin mb-4" />
          <p className="text-muted-foreground">Loading match...</p>
        </main>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-6 mb-6">
            <p className="font-medium mb-4">Error: {error}</p>
            <Link href="/matches" className="text-destructive hover:underline">Back to Matches</Link>
          </div>
        </main>
      </div>
    )
  }

  if (!match) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="flex flex-col items-center justify-center py-20">
          <p className="text-muted-foreground mb-4">Match not found</p>
          <Link href="/matches" className="text-primary hover:underline">Back to Matches</Link>
        </main>
      </div>
    )
  }

  // If the match started, show nothing — the redirect effect will fire
  if (matchStarted) return null

  const isFull = players.length >= match.max_players
  const hasAgents = agents.length > 0

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Match Header */}
        <div className="glass-card p-8 mb-12">
          <div className="flex items-start justify-between mb-6">
            <div className="flex-1">
              <h1 className="text-4xl md:text-5xl font-bold gradient-text mb-2">{match.title}</h1>
              <p className="text-lg text-muted-foreground">{match.description}</p>
              {match.home_team && match.away_team && (
                <p className="text-sm text-muted-foreground mt-1">{match.home_team} vs {match.away_team}</p>
              )}
            </div>
            <div className="ml-4">
              <span className="inline-block px-4 py-2 rounded-lg text-sm font-semibold bg-secondary/20 text-secondary">
                Pending
              </span>
            </div>
          </div>

          {game && (
            <div className="bg-background rounded-lg border border-border/30 p-6 mb-6">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Live Event</p>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-foreground">{game.team_a} vs {game.team_b}</h2>
                  <p className="text-sm text-muted-foreground mt-2">{game.sport.toUpperCase()}</p>
                </div>
              </div>
            </div>
          )}

          {/* Match Code */}
          <div className="flex flex-col sm:flex-row items-center gap-4 pt-6 border-t border-border/30">
            <div className="flex-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Secret Code</p>
              <code
                className="px-4 py-2 bg-background rounded-lg text-lg font-mono font-medium text-primary tracking-wider w-full text-center cursor-pointer hover:bg-primary/5 transition-all select-all"
                onClick={copyCode}
                title="Click to copy"
              >
                {secretCode ? `${secretCode.substring(0, 4)}${'•'.repeat(24)}${secretCode.substring(28)}` : 'Loading...'}
              </code>
            </div>
            <button onClick={copyCode} className="flex-shrink-0 p-2 text-primary hover:bg-primary/10 rounded-lg transition-all" title="Copy secret code">
              {copied ? <span className="text-xs font-bold">✓ Copied</span> : <Copy className="w-4 h-4" />}
            </button>
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Players</p>
              <p className="text-2xl font-bold gradient-text">{players.length}/{match.max_players}</p>
            </div>
          </div>
        </div>

        {/* Join Button */}
        {!isPlayerInMatch && !isFull && (
          <button
            onClick={joinMatch}
            disabled={joining}
            className="mb-8 flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-primary to-secondary text-background rounded-lg font-bold text-lg hover:shadow-lg hover:shadow-primary/50 transition-all disabled:opacity-50"
          >
            {joining ? <><Loader className="w-5 h-5 animate-spin" /> Joining...</> : <><Plus className="w-5 h-5" /> Join Match</>}
          </button>
        )}

        {isFull && (
          <div className="mb-8 p-4 bg-secondary/20 border border-secondary/50 text-secondary rounded-lg">
            This match is full
          </div>
        )}

        {/* Start Match Button */}
        {isPlayerInMatch && (
          <button
            onClick={startMatch}
            disabled={starting}
            className="mb-8 flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-primary to-secondary text-background rounded-lg font-bold text-lg hover:shadow-lg hover:shadow-primary/50 transition-all disabled:opacity-50"
          >
            {starting ? <><Loader className="w-5 h-5 animate-spin" /> Starting...</> : <><Play className="w-6 h-6" /> Start Match</>}
          </button>
        )}

        {/* Players Section */}
        <div className="glass-card p-8 mb-12">
          <h2 className="text-3xl font-bold gradient-text mb-8">Players</h2>
          {players.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground text-lg">No players yet. Be the first to join!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {players.map((player) => (
                <div key={player.id} className="bg-background rounded-lg border border-border/30 hover:border-primary/50 p-6 transition-all">
                  <div className="mb-6">
                    <h3 className="text-xl font-bold text-foreground mb-1">{player.player_name}</h3>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">ID: {player.player_id.split('-').pop()}</p>
                  </div>
                  <div className="mb-6 p-4 bg-gradient-to-r from-primary/10 to-secondary/10 rounded-lg border border-primary/20">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs text-muted-foreground uppercase tracking-wide">Purse</span>
                      <span className="text-2xl font-bold gradient-text">${(player.purse ?? 1000).toLocaleString()}</span>
                    </div>
                  </div>
                  {player.agent_name ? (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Selected Agent</p>
                      <p className="text-lg font-semibold text-primary">{player.agent_name}</p>
                    </div>
                  ) : (
                    <div>
                      {!hasAgents ? (
                        <div className="space-y-3">
                          <p className="text-sm text-muted-foreground">No agents available</p>
                          <Link href="/agents/create" className="inline-block px-4 py-2 bg-gradient-to-r from-primary to-secondary text-background rounded-lg text-sm font-medium hover:shadow-lg hover:shadow-primary/50 transition-all">
                            Create First Agent
                          </Link>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-3">Select Agent</p>
                          <select
                            onChange={(e) => {
                              const agent = agents.find(a => a.id === e.target.value)
                              if (agent) selectAgent(player.player_id, agent.id, agent.name)
                            }}
                            className="w-full px-4 py-3 bg-background border border-border/50 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
                          >
                            <option value="">Choose an agent...</option>
                            {agents.map((agent) => (
                              <option key={agent.id} value={agent.id}>{agent.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
