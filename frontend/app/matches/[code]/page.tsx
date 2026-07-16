'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/header'
import AgentChart from '@/components/agent-chart'
import { Copy, Plus, Loader, Users, AlertCircle, Play } from 'lucide-react'
import { useAuth } from '@/app/providers'
import type { Match, MatchPlayer, Game } from '@/lib/supabase'

export default function MatchDetailPage({ params }: { params: Promise<{ code: string }> | { code: string } }) {
  const { user } = useAuth()
  const searchParams = useSearchParams()
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
  const [countdown, setCountdown] = useState<number | null>(null)
  const [showCharts, setShowCharts] = useState(false)

  // Single source of truth for "has the match started" — comes from the
  // database (match.status) so every connected player sees the same state,
  // instead of a local-only flag that only ever changed in one browser tab.
  const matchStarted = match?.status === 'active' || match?.status === 'completed'

  const initCode = async () => {
    try {
      // Handle both Promise and direct params
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const fetchMatchData = useCallback(async () => {
    try {
      setLoading(true)
      
      // Fetch match details
      const matchResponse = await fetch(`/api/matches/${code}`)
      const matchData = await matchResponse.json()

      if (!matchResponse.ok) {
        throw new Error(matchData.error || 'Match not found')
      }

      setMatch(matchData.match)
      setSecretCode(matchData.match?.secret_code || '')
      const playersData = matchData.players || []
      
      setPlayers(playersData)

      // Fetch game details if match has game_id
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

      // Fetch available agents for current user
      const agentsUrl = new URL('/api/agents', window.location.origin)
      if (user?.id) {
        agentsUrl.searchParams.append('userId', user.id)
      }
      const agentsResponse = await fetch(agentsUrl.toString())
      const agentsData = await agentsResponse.json()
      if (agentsResponse.ok) {
        setAgents(agentsData.agents || [])
      }

      setError(null)
    } catch (err) {
      console.error('[v0] Error fetching match:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch match')
    } finally {
      setLoading(false)
    }
  }, [code, user])

  useEffect(() => {
    if (code) {
      fetchMatchData()
      // Keep polling while this match page is open. This is what makes the
      // match feel "multiplayer": when one player starts the match (or a new
      // player joins), every other browser polling this endpoint picks up
      // the change within a few seconds and updates its own UI.
      const interval = setInterval(() => {
        fetchMatchData()
      }, 3000)
      return () => clearInterval(interval)
    }
  }, [code, fetchMatchData])

  // Once the DB says the match is active, run a local countdown animation
  // and then reveal the charts. This runs independently in every browser
  // tab, so all players see the same countdown-then-charts sequence shortly
  // after whichever player clicked "Start Match".
  useEffect(() => {
    if (matchStarted && countdown === null && !showCharts) {
      setCountdown(3)
    }
  }, [matchStarted, countdown, showCharts])

  useEffect(() => {
    if (countdown === null) return

    if (countdown <= 0) {
      const timeout = setTimeout(() => {
        setShowCharts(true)
        setCountdown(null)
      }, 800)
      return () => clearTimeout(timeout)
    }

    const timeout = setTimeout(() => {
      setCountdown((c) => (c !== null ? c - 1 : c))
    }, 1000)
    return () => clearTimeout(timeout)
  }, [countdown])

  const isPlayerInMatch = user && players.some(p => p.player_id === user.id)

  const startMatch = async () => {
    setStarting(true)
    try {
      const response = await fetch(`/api/matches/${code}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start match')
      }

      // Update local state immediately for the player who clicked the
      // button; every other player's poll will pick up match.status shortly.
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
      }).catch(() => {
        // Fallback: select text for manual copy
        const element = document.createElement('textarea')
        element.value = secretCode
        document.body.appendChild(element)
        element.select()
        try {
          document.execCommand('copy')
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch (err) {
          console.log('[v0] Copy failed:', err)
        }
        document.body.removeChild(element)
      })
    } else {
      // Fallback: select text for manual copy
      const element = document.createElement('textarea')
      element.value = secretCode
      document.body.appendChild(element)
      element.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch (err) {
        console.log('[v0] Copy failed:', err)
      }
      document.body.removeChild(element)
    }
  }

  const joinMatch = async () => {
    // Check if user is the creator
    if (match && user && match.creator_id === user.id) {
      alert('You cannot join your own match')
      return
    }

    // Check if they have agents
    if (agents.length === 0) {
      alert('You must create an agent before joining a match')
      return
    }

    // Prompt to select agent before joining
    const agentSelect = prompt(
      'Select an agent to join the match. Agent IDs:\n' +
      agents.map((a, i) => `${i + 1}. ${a.name}`).join('\n') +
      '\n\nEnter the agent name:',
      agents[0]?.name || ''
    )

    if (!agentSelect) {
      return
    }

    const selectedAgent = agents.find(a => a.name === agentSelect)
    if (!selectedAgent) {
      alert('Agent not found')
      return
    }

    const playerName = user?.name || user?.email || 'Player'
    const playerId = user?.id

    setJoining(true)

    try {
      const response = await fetch(`/api/matches/${code}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          player_id: playerId,
          player_name: playerName,
          agent_id: selectedAgent.id,
          agent_name: selectedAgent.name,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to join match')
      }

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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: agentId,
          agent_name: agentName,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to select agent')
      }

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
            <Link href="/matches" className="text-destructive hover:underline">
              Back to Matches
            </Link>
          </div>
        </main>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="flex flex-col items-center justify-center py-20 min-h-screen">
          <Loader className="w-8 h-8 text-primary animate-spin" />
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
          <Link href="/matches" className="text-primary hover:underline">
            Back to Matches
          </Link>
        </main>
      </div>
    )
  }



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
            </div>
            <div className="ml-4">
              <span className={`inline-block px-4 py-2 rounded-lg text-sm font-semibold ${
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

          {/* Game Info */}
          {game && (
            <div className="bg-background rounded-lg border border-border/30 p-6 mb-6">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Live Event</p>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-foreground">
                    {game.team_a} vs {game.team_b}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-2">{game.sport.toUpperCase()}</p>
                </div>
                <div className="text-right">
                  <span className={`inline-block px-3 py-1 rounded-lg text-xs font-medium ${
                    game.status === 'ongoing' ? 'bg-accent/20 text-accent' :
                    game.status === 'completed' ? 'bg-muted text-muted-foreground' :
                    'bg-secondary/20 text-secondary'
                  }`}>
                    {game.status.charAt(0).toUpperCase() + game.status.slice(1)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Match Code Section */}
          <div className="flex flex-col sm:flex-row items-center gap-4 pt-6 border-t border-border/30">
            <div className="flex-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Secret Code</p>
              <code 
                className="px-6 py-4 bg-background rounded-lg text-3xl font-mono font-bold text-primary tracking-widest w-full text-center cursor-pointer hover:bg-primary/5 transition-all select-all"
                onClick={copyCode}
                title="Click to copy"
              >
                {secretCode ? `${secretCode.substring(0, 4)}${'•'.repeat(24)}${secretCode.substring(28)}` : 'Loading...'}
              </code>
            </div>
            <button
              onClick={copyCode}
              className="flex-shrink-0 p-3 text-primary hover:bg-primary/10 rounded-lg transition-all"
              title="Copy secret code"
            >
              {copied ? (
                <span className="text-sm font-bold">✓ Copied</span>
              ) : (
                <Copy className="w-6 h-6" />
              )}
            </button>
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Players</p>
              <p className="text-3xl font-bold gradient-text">{players.length}/{match.max_players}</p>
            </div>
          </div>
        </div>

        {/* Join Button - Only show if user is not already a member */}
        {!isPlayerInMatch && !isFull && (
          <button
            onClick={joinMatch}
            disabled={joining}
            className="mb-8 flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-primary to-secondary text-background rounded-lg font-bold text-lg hover:shadow-lg hover:shadow-primary/50 transition-all disabled:opacity-50"
          >
            {joining ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                Joining...
              </>
            ) : (
              <>
                <Plus className="w-5 h-5" />
                Join Match
              </>
            )}
          </button>
        )}

        {isFull && (
          <div className="mb-8 p-4 bg-secondary/20 border border-secondary/50 text-secondary rounded-lg">
            This match is full
          </div>
        )}

        {/* Start Match Button - Only for members */}
        {isPlayerInMatch && !matchStarted && (
          <button
            onClick={startMatch}
            disabled={starting}
            className="mb-8 flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-primary to-secondary text-background rounded-lg font-bold text-lg hover:shadow-lg hover:shadow-primary/50 transition-all disabled:opacity-50"
          >
            {starting ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Play className="w-6 h-6" />
                Start Match
              </>
            )}
          </button>
        )}

        {/* Countdown Display */}
        {countdown !== null && (
          <div className="mb-8 flex items-center justify-center">
            <div className="text-9xl font-bold gradient-text animate-pulse">
              {countdown === 0 ? 'GO!' : countdown}
            </div>
          </div>
        )}



        {/* Players Section */}
        {!matchStarted && (
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
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">ID: {player.player_id.split('-')[player.player_id.split('-').length - 1]}</p>
                  </div>

                  {/* Purse Display */}
                  <div className="mb-6 p-4 bg-gradient-to-r from-primary/10 to-secondary/10 rounded-lg border border-primary/20">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs text-muted-foreground uppercase tracking-wide">Purse</span>
                      <span className="text-2xl font-bold gradient-text">
                        ${(player.purse ?? 1000).toLocaleString()}
                      </span>
                    </div>
                    {(player.pnl ?? 0) !== 0 && (
                      <div className="flex justify-between items-center pt-2 border-t border-border/30">
                        <span className="text-xs text-muted-foreground uppercase tracking-wide">P&L</span>
                        <span className={`text-sm font-bold ${(player.pnl ?? 0) >= 0 ? 'text-primary' : 'text-destructive'}`}>
                          {(player.pnl ?? 0) >= 0 ? '+' : ''}{(player.pnl ?? 0).toLocaleString()}
                        </span>
                      </div>
                    )}
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
                          <Link
                            href="/agents/create"
                            className="inline-block px-4 py-2 bg-gradient-to-r from-primary to-secondary text-background rounded-lg text-sm font-medium hover:shadow-lg hover:shadow-primary/50 transition-all"
                          >
                            Create First Agent
                          </Link>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-3">Select Agent</p>
                          <select
                            onChange={(e) => {
                              const agent = agents.find(a => a.id === e.target.value)
                              if (agent) {
                                selectAgent(player.player_id, agent.id, agent.name)
                              }
                            }}
                            className="w-full px-4 py-3 bg-background border border-border/50 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
                          >
                            <option value="">Choose an agent...</option>
                            {agents.map((agent) => (
                              <option key={agent.id} value={agent.id}>
                                {agent.name}
                              </option>
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
        )}

        {/* Agent Performance Charts */}
        {showCharts && players.length > 0 && (
          <div className="mb-12">
            <h2 className="text-3xl font-bold gradient-text mb-8">Agent Performance</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {players.map((player) => {
                // Real data: use player's purse and pnl if available
                const realizedPnL = player.pnl || 0
                const currentBalance = player.purse || 1000
                const unrealizedPnL = 0
                
                // Generate chart data based on current balance only
                const chartData = [
                  {
                    timestamp: '0:00',
                    balance: currentBalance,
                    odds: 1.5,
                  }
                ]

                return (
                  <AgentChart
                    key={player.id}
                    title={player.player_name}
                    data={chartData}
                    balance={currentBalance}
                    realizedPnL={realizedPnL}
                    unrealizedPnL={unrealizedPnL}
                    tradeCount={0}
                    color="#a78bfa"
                    gridColor="#2a2a3e"
                    axisColor="#a1a1a1"
                  />
                )
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

