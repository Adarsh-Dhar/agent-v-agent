'use client'

import { useState, useEffect } from 'react'
import Header from '@/components/header'
import { Trophy, Loader } from 'lucide-react'
import { formatSol } from '@/lib/currency'
import { useAuth } from '@/app/providers'

type LeaderboardEntry = {
  player_ids: string[]
  player_name: string
  total_pnl: number
  matches_played: number
}

export default function LeaderboardPage() {
  const { user } = useAuth()
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const res = await fetch('/api/leaderboard')
        const data = await res.json()
        setEntries(data.leaderboard || [])
      } catch (err) {
        console.error('[v0] Error fetching leaderboard:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchLeaderboard()
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center gap-3 mb-8">
          <Trophy className="w-8 h-8 text-amber-400" />
          <h1 className="text-3xl font-bold gradient-text">Leaderboard</h1>
        </div>

        {loading ? (
          <div className="glass-card p-12 text-center">
            <Loader className="w-8 h-8 text-primary animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground">Loading leaderboard...</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <p className="text-muted-foreground text-lg">No matches played yet.</p>
            <p className="text-sm text-muted-foreground mt-2">Play a match to appear on the leaderboard.</p>
          </div>
        ) : (
          <div className="glass-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Rank</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Player</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Matches</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total PnL</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => {
                  const isUser = user && entry.player_ids.includes(user.id)
                  return (
                    <tr
                      key={entry.player_name}
                      className={`border-b border-border/30 hover:bg-secondary/10 transition-colors ${isUser ? 'bg-primary/5' : ''}`}
                    >
                      <td className="px-6 py-4">
                        <span className={`text-sm font-bold ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-zinc-300' : i === 2 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                          #{i + 1}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-sm font-semibold ${isUser ? 'text-primary' : 'text-foreground'}`}>
                          {entry.player_name}
                          {isUser && <span className="ml-2 text-xs text-primary/60">(you)</span>}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-sm text-muted-foreground">{entry.matches_played}</td>
                      <td className={`px-6 py-4 text-right text-sm font-semibold ${entry.total_pnl >= 0 ? 'text-accent' : 'text-destructive'}`}>
                        {entry.total_pnl >= 0 ? '+' : ''}{formatSol(entry.total_pnl)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
