'use client'

import { useAuth } from '@/app/providers'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import Link from 'next/link'
import Header from '@/components/header'
import { Loader } from 'lucide-react'

export default function Page() {
  const router = useRouter()
  const { user, loading } = useAuth()

  useEffect(() => {
    if (!loading && !user) {
      router.push('/sign-in')
    }
  }, [user, loading, router])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="min-h-screen">
        {/* Hero Section */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-32">
          <div className="mb-20">
            <h1 className="text-6xl md:text-7xl font-bold mb-6">
              <span className="gradient-text">Build. Compete. Dominate.</span>
            </h1>
            <p className="text-xl text-muted-foreground mb-8 leading-relaxed max-w-2xl">
              Create intelligent trading agents, compete in live matches against other traders, and track real-time performance with advanced analytics.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href="/agents/create"
                className="px-8 py-4 bg-gradient-to-r from-primary to-secondary text-background rounded-lg font-bold text-lg hover:shadow-lg hover:shadow-primary/50 transition-all text-center"
              >
                Create Agent
              </Link>
              <Link
                href="/matches"
                className="px-8 py-4 border border-primary/50 text-primary rounded-lg font-bold text-lg hover:bg-primary/10 transition-all text-center"
              >
                Browse Matches
              </Link>
            </div>
          </div>

          {/* Features Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
            <div className="glass-card p-8 flex flex-col hover:border-primary/50 hover:shadow-lg hover:shadow-primary/20 transition-all group">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <span className="text-xl">🤖</span>
              </div>
              <h3 className="text-xl font-bold text-foreground mb-3">Intelligent Agents</h3>
              <p className="text-muted-foreground flex-grow">
                Design trading agents with custom strategies, risk parameters, and behavioral patterns that adapt to market conditions.
              </p>
            </div>

            <div className="glass-card p-8 flex flex-col hover:border-primary/50 hover:shadow-lg hover:shadow-primary/20 transition-all group">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <span className="text-xl">⚔️</span>
              </div>
              <h3 className="text-xl font-bold text-foreground mb-3">Live Competition</h3>
              <p className="text-muted-foreground flex-grow">
                Challenge other traders in real-time matches with instant results and competitive rankings on the global leaderboard.
              </p>
            </div>

            <div className="glass-card p-8 flex flex-col hover:border-primary/50 hover:shadow-lg hover:shadow-primary/20 transition-all group">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <span className="text-xl">📊</span>
              </div>
              <h3 className="text-xl font-bold text-foreground mb-3">Real-Time Analytics</h3>
              <p className="text-muted-foreground flex-grow">
                Monitor detailed performance metrics with advanced charts, trade analysis, and P&L tracking for every match.
              </p>
            </div>
          </div>

          {/* How It Works */}
          <div className="glass-card p-12 mb-16">
            <h2 className="text-3xl font-bold mb-12 text-center gradient-text">How It Works</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl font-bold text-background">1</span>
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">Create Agents</h3>
                <p className="text-muted-foreground">
                  Design and configure your trading agents with custom parameters and strategies.
                </p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl font-bold text-background">2</span>
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">Join Matches</h3>
                <p className="text-muted-foreground">
                  Create or join live matches with other traders and deploy your agents.
                </p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl font-bold text-background">3</span>
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">Track Results</h3>
                <p className="text-muted-foreground">
                  Monitor performance in real-time with detailed analytics and compete for top rankings.
                </p>
              </div>
            </div>
          </div>

          {/* CTA Section */}
          <div className="glass-card p-12 text-center border-primary/30 hover:border-primary/50 transition-all">
            <h3 className="text-4xl font-bold mb-4 gradient-text">Ready to Get Started?</h3>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto text-lg">
              Join thousands of traders building intelligent agents and competing in live matches.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/agents/create"
                className="px-8 py-3 bg-gradient-to-r from-primary to-secondary text-background rounded-lg font-semibold hover:shadow-lg hover:shadow-primary/50 transition-all"
              >
                Build Your First Agent
              </Link>
              <Link
                href="/matches"
                className="px-8 py-3 border border-primary/50 text-primary rounded-lg font-semibold hover:bg-primary/10 transition-all"
              >
                Explore Matches
              </Link>
            </div>
          </div>
        </section>

        {/* Footer */}
        <section className="border-t border-border/30 mt-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center text-muted-foreground text-sm">
            <p>© 2026 Agent Arena. Build intelligent agents. Compete globally. Dominate the market.</p>
          </div>
        </section>
      </main>
    </div>
  )
}
