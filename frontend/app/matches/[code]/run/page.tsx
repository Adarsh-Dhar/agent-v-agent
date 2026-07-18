'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Header from '@/components/header'
import AgentChart from '@/components/agent-chart'
import MatchOddsChart from '@/components/match-odds-chart'
import { Loader, Play } from 'lucide-react'
import { useAuth } from '@/app/providers'
import type { Match, MatchPlayer, Game } from '@/lib/supabase'

export default function MatchRunPage({ params }: { params: Promise<{ code: string }> | { code: string } }) {
  const router = useRouter()
  const { user } = useAuth()
  const [code, setCode] = useState<string>('')
  const [match, setMatch] = useState<Match | null>(null)
  const [game, setGame] = useState<Game | null>(null)
  const [players, setPlayers] = useState<MatchPlayer[]>([])
  const [ticks, setTicks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [initialLoadDone, setInitialLoadDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [showCharts, setShowCharts] = useState(false)

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

  const fetchMatchData = useCallback(async (isPoll = false) => {
    if (!code) return
    try {
      if (!initialLoadDone) setLoading(true)

      const matchResponse = await fetch(`/api/matches/${code}`)
      const matchData = await matchResponse.json()
      if (!matchResponse.ok) throw new Error(matchData.error || 'Match not found')

      setMatch(matchData.match)
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

      try {
        const ticksResponse = await fetch(`/api/matches/${code}/ticks`)
        if (ticksResponse.ok) {
          const ticksData = await ticksResponse.json()
          setTicks(ticksData.ticks || [])
        }
      } catch (err) {
        console.error('[v0] Error fetching match ticks:', err)
      }

      setError(null)
    } catch (err) {
      console.error('[v0] Error fetching match:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch match')
    } finally {
      setLoading(false)
      setInitialLoadDone(true)
    }
  }, [code, initialLoadDone])

  // Initial fetch + realtime subscriptions
  useEffect(() => {
    if (!code) return
    fetchMatchData()

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
          .channel(`match-run-${code}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `code=eq.${code}` }, (p: any) => {
            if (p.new) setMatch(p.new as Match)
          })
          .subscribe()

        playersSub = supabase
          .channel(`match-players-run-${code}`)
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
  }, [code, fetchMatchData])

  // Start agent runs once DB says active
  const startAgentRuns = async () => {
    if (!match) return
    const playersWithAgents = players.filter(p => p.agent_id)
    if (playersWithAgents.length === 0) return

    const matchIdForAgents = match.agent_match_id || match.id
    await Promise.allSettled(
      playersWithAgents.map(async (player) => {
        const runResponse = await fetch(`/api/agents/${player.agent_id}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            match_id: matchIdForAgents,
            budget_cap: (player.purse ?? 1000) / 1000,
          }),
        })
        const runData = await runResponse.json()
        if (!runResponse.ok) throw new Error(runData.error || 'Failed to start run')
        return { player: player.player_name, runData }
      })
    )
  }

  // Countdown → showCharts → startAgentRuns
  useEffect(() => {
    if (matchStarted && countdown === null && !showCharts) {
      setCountdown(3)
    }
  }, [matchStarted, countdown, showCharts])

  useEffect(() => {
    if (countdown === null) return
    if (countdown <= 0) {
      const t = setTimeout(() => {
        setShowCharts(true)
        setCountdown(null)
        startAgentRuns()
      }, 800)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setCountdown(c => (c !== null ? c - 1 : c)), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  // Live polling while charts shown
  useEffect(() => {
    if (!showCharts || !code) return
    const interval = setInterval(() => fetchMatchData(true), 3000)
    return () => clearInterval(interval)
  }, [showCharts, code, fetchMatchData])

  const stopMatch = async () => {
    setStopping(true)
    try {
      const response = await fetch(`/api/matches/${code}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending' }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to stop match')
      setMatch(data.match)
      setShowCharts(false)
      setCountdown(null)
      router.replace(`/matches/${code}`)
    } catch (err) {
      console.error('[v0] Error stopping match:', err)
      alert(err instanceof Error ? err.message : 'Failed to stop match')
    } finally {
      setStopping(false)
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

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Match Header */}
        <div className="glass-card p-8 mb-8">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <h1 className="text-3xl md:text-4xl font-bold gradient-text mb-2">{match.title}</h1>
              {match.home_team && match.away_team && (
                <p className="text-lg text-muted-foreground">{match.home_team} vs {match.away_team}</p>
              )}
            </div>
            <div className="ml-4">
              <span className={`inline-block px-4 py-2 rounded-lg text-sm font-semibold ${
                match.status === 'active' ? 'bg-accent/20 text-accent' :
                match.status === 'completed' ? 'bg-muted text-muted-foreground' :
                'bg-secondary/20 text-secondary'
              }`}>
                {match.status.charAt(0).toUpperCase() + match.status.slice(1)}
              </span>
            </div>
          </div>

          {/* Player pills */}
          <div className="flex flex-wrap gap-3 pt-4 border-t border-border/30">
            {players.map((p: any) => {
              const agent = p.agent
              const budgetCap = agent?.budget_cap ?? p.initial_purse ?? 1000
              const realizedPnL = agent?.realized_pnl ?? 0
              const unrealizedPnL = agent?.unrealized_pnl ?? 0
              const equity = budgetCap + realizedPnL + unrealizedPnL
              return (
                <div key={p.id} className="bg-background rounded-lg border border-border/30 px-4 py-2">
                  <span className="text-sm font-medium text-foreground">{p.player_name}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    ${equity.toFixed(0)} ({realizedPnL >= 0 ? '+' : ''}{realizedPnL.toFixed(2)})
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Stop Button */}
        <button
          onClick={stopMatch}
          disabled={stopping}
          className="mb-8 flex items-center gap-2 px-6 py-3 bg-destructive text-destructive-foreground rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {stopping ? <><Loader className="w-4 h-4 animate-spin" /> Stopping...</> : <>Stop Match</>}
        </button>

        {/* Countdown */}
        {countdown !== null && (
          <div className="mb-8 flex items-center justify-center">
            <div className="text-9xl font-bold gradient-text animate-pulse">
              {countdown === 0 ? 'GO!' : countdown}
            </div>
          </div>
        )}

        {/* Live Odds Chart */}
        {showCharts && (
          <MatchOddsChart
            ticks={ticks}
            homeTeam={match.home_team || game?.team_a}
            awayTeam={match.away_team || game?.team_b}
          />
        )}

        {/* Agent Performance Charts */}
        {showCharts && players.length > 0 && (
          <div className="mb-12">
            <h2 className="text-3xl font-bold gradient-text mb-8">Agent Performance</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {players.map((player: any) => {
                const agent = player.agent
                const trades = player.trades || []
                const budgetCap = agent?.budget_cap ?? player.initial_purse ?? 1000
                const realizedPnL = agent?.realized_pnl ?? 0
                const unrealizedPnL = agent?.unrealized_pnl ?? 0
                const currentBalance = budgetCap + realizedPnL + unrealizedPnL
                const tradeCount = agent?.trade_count ?? trades.length

                const chartData = trades.length > 0
                  ? trades.map((t: any, i: number) => ({
                      timestamp: new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                      balance: t.balance_after != null
                        ? t.balance_after
                        : budgetCap + ((currentBalance - budgetCap) * (i + 1)) / trades.length,
                      odds: t.odds,
                    }))
                  : [{ timestamp: '0:00', balance: currentBalance, odds: 1.5 }]

                return (
                  <AgentChart
                    key={player.id}
                    title={player.player_name}
                    data={chartData}
                    balance={currentBalance}
                    initialBalance={budgetCap}
                    realizedPnL={realizedPnL}
                    unrealizedPnL={unrealizedPnL}
                    tradeCount={tradeCount}
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
