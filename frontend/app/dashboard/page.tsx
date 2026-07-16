'use client'

import { useAuth } from '@/app/providers'
import { Loader } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function DashboardPage() {
  const router = useRouter()
  const { user, player, loading, signOut } = useAuth()

  // Redirect to login if not authenticated after loading
  useEffect(() => {
    if (!loading && (!user || !player)) {
      router.push('/sign-in')
    }
  }, [user, player, loading, router])

  // Force check demo mode if loading takes too long
  useEffect(() => {
    const timer = setTimeout(() => {
      if (loading) {
        const demoPlayer = localStorage.getItem('demo_player')
        const demoUser = localStorage.getItem('demo_user')
        if (demoPlayer && demoUser) {
          console.log('[v0] Forcing demo mode load after timeout')
        }
      }
    }, 3000)
    return () => clearTimeout(timer)
  }, [loading])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user || !player) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  const handleSignOut = async () => {
    await signOut()
    router.push('/auth/login')
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-md bg-background/80">
        <div className="max-w-7xl mx-auto px-4 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
              <span className="text-lg font-bold text-background">⚡</span>
            </div>
            <h1 className="text-2xl font-bold gradient-text">Agent Arena</h1>
          </div>
          <button
            onClick={handleSignOut}
            className="px-4 py-2 bg-destructive/20 text-destructive hover:bg-destructive/30 rounded-lg transition-colors text-sm font-medium border border-destructive/30"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="min-h-screen">
        {/* Hero Section */}
        <section className="max-w-7xl mx-auto px-4 py-20 md:py-32">
          <div className="text-center mb-12">
            <h2 className="text-5xl md:text-7xl font-bold mb-6">
              <span className="gradient-text">Welcome back, {player.name}</span>
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
              Master the art of algorithmic trading. Build intelligent agents, compete in live matches, and dominate the leaderboard.
            </p>
          </div>

          {/* Stats Grid */}
          {(player.total_trades !== undefined || player.total_pnl !== undefined || player.win_rate !== undefined) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
              {player.total_trades !== undefined && (
                <div className="glass-card p-8 border-primary/20 hover:border-primary/50 transition-all">
                  <p className="text-sm text-muted-foreground mb-2 uppercase tracking-wider">Total Trades</p>
                  <p className="text-4xl font-bold gradient-text">{player.total_trades}</p>
                  <p className="text-xs text-muted-foreground mt-3">Executed across all matches</p>
                </div>
              )}
              {player.total_pnl !== undefined && (
                <div className="glass-card p-8 border-primary/20 hover:border-primary/50 transition-all">
                  <p className="text-sm text-muted-foreground mb-2 uppercase tracking-wider">Total P&L</p>
                  <p className={`text-4xl font-bold ${player.total_pnl >= 0 ? 'gradient-text' : 'text-destructive'}`}>
                    ${player.total_pnl.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-3">{player.total_pnl >= 0 ? 'Profit' : 'Loss'} accumulated</p>
                </div>
              )}
              {player.win_rate !== undefined && (
                <div className="glass-card p-8 border-primary/20 hover:border-primary/50 transition-all">
                  <p className="text-sm text-muted-foreground mb-2 uppercase tracking-wider">Win Rate</p>
                  <p className="text-4xl font-bold gradient-text">{player.win_rate.toFixed(1)}%</p>
                  <p className="text-xs text-muted-foreground mt-3">Success rate in trades</p>
                </div>
              )}
            </div>
          )}

          {/* Features Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
            {/* Feature 1: Agents */}
            <div className="glass-card p-8 flex flex-col hover:border-primary/50 hover:shadow-lg hover:shadow-primary/20 transition-all group">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <span className="text-xl">🤖</span>
              </div>
              <h3 className="text-xl font-bold text-foreground mb-3">Create Agents</h3>
              <p className="text-muted-foreground mb-6 flex-grow">
                Design and deploy intelligent trading agents with custom strategies, risk parameters, and behavioral patterns
              </p>
              <Link
                href="/agents"
                className="inline-flex items-center gap-2 text-primary hover:text-secondary transition-colors font-semibold"
              >
                Build Agents <span>→</span>
              </Link>
            </div>

            {/* Feature 2: Matches */}
            <div className="glass-card p-8 flex flex-col hover:border-primary/50 hover:shadow-lg hover:shadow-primary/20 transition-all group">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <span className="text-xl">⚔️</span>
              </div>
              <h3 className="text-xl font-bold text-foreground mb-3">Live Matches</h3>
              <p className="text-muted-foreground mb-6 flex-grow">
                Compete against other traders in real-time matches with live performance tracking and instant results
              </p>
              <Link
                href="/matches"
                className="inline-flex items-center gap-2 text-primary hover:text-secondary transition-colors font-semibold"
              >
                Join Matches <span>→</span>
              </Link>
            </div>

            {/* Feature 3: Analytics */}
            <div className="glass-card p-8 flex flex-col hover:border-primary/50 hover:shadow-lg hover:shadow-primary/20 transition-all group">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <span className="text-xl">📊</span>
              </div>
              <h3 className="text-xl font-bold text-foreground mb-3">Real-Time Analytics</h3>
              <p className="text-muted-foreground mb-6 flex-grow">
                Monitor agent performance with advanced charts, metrics, and detailed trade analysis in every match
              </p>
              <Link
                href="/matches"
                className="inline-flex items-center gap-2 text-primary hover:text-secondary transition-colors font-semibold"
              >
                View Analytics <span>→</span>
              </Link>
            </div>
          </div>

          {/* Call to Action Section */}
          <div className="glass-card p-12 text-center border-primary/30 hover:border-primary/50 transition-all">
            <h3 className="text-3xl font-bold mb-4 gradient-text">Ready to get started?</h3>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
              Create your first trading agent and challenge other traders in competitive matches
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/agents/create"
                className="px-8 py-3 bg-gradient-to-r from-primary to-secondary text-background rounded-lg font-semibold hover:shadow-lg hover:shadow-primary/50 transition-all"
              >
                Create First Agent
              </Link>
              <Link
                href="/matches"
                className="px-8 py-3 border border-primary/50 text-primary rounded-lg font-semibold hover:bg-primary/10 transition-all"
              >
                Browse Matches
              </Link>
            </div>
          </div>
        </section>

        {/* Footer */}
        <section className="border-t border-border/30 mt-20">
          <div className="max-w-7xl mx-auto px-4 py-12 text-center text-muted-foreground text-sm">
            <p>© 2026 Agent Arena. Build. Compete. Dominate.</p>
          </div>
        </section>
      </main>
    </div>
  )
}
