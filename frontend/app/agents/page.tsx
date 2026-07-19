'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Header from '@/components/header'
import { Search, Plus, Trash2, Loader } from 'lucide-react'
import { useAuth } from '@/app/providers'
import { formatSol } from '@/lib/currency'
import type { Agent } from '@/lib/supabase'

export default function AgentsPage() {
  const { user } = useAuth()
  const [searchTerm, setSearchTerm] = useState('')
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true)
      const url = new URL('/api/agents', window.location.origin)
      url.searchParams.append('userId', user?.id || '')
      
      const response = await fetch(url.toString())
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch agents')
      }

      setAgents(data.agents || [])
      setError(null)
    } catch (err) {
      console.error('[v0] Error fetching agents:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch agents')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (user?.id) {
      fetchAgents()
    }
  }, [user?.id, fetchAgents])

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this agent?')) return

    try {
      setDeleting(id)
      const response = await fetch(`/api/agents/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete agent')
      }

      setAgents(agents.filter(agent => agent.id !== id))
    } catch (err) {
      console.error('[v0] Error deleting agent:', err)
      alert(err instanceof Error ? err.message : 'Failed to delete agent')
    } finally {
      setDeleting(null)
    }
  }

  const calculateROI = (agent: Agent) => {
    if (agent.budget_cap === 0 || agent.balance === 0 || agent.trade_count === 0) return 0
    return ((agent.balance - agent.budget_cap) / agent.budget_cap) * 100
  }

  const filteredAgents = agents.filter(agent =>
    agent.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold gradient-text mb-2">Agents</h1>
            <p className="text-muted-foreground">Manage and monitor your trading agents</p>
          </div>
          <Link
            href="/agents/create"
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary to-secondary text-background rounded-lg text-sm font-medium hover:shadow-lg hover:shadow-primary/50 transition-all"
          >
            <Plus className="w-4 h-4" />
            Create Agent
          </Link>
        </div>

        {/* Search Bar */}
        <div className="mb-6 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search agents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-input/50 border border-border/50 rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader className="w-8 h-8 text-primary animate-spin mb-4" />
            <p className="text-muted-foreground">Loading agents...</p>
          </div>
        )}

        {/* Error State - Setup Required */}
        {error && !loading && error.includes('Could not find the table') && (
          <div className="flex flex-col items-center justify-center py-20 min-h-[600px]">
            <div className="bg-card rounded-lg border border-border p-12 max-w-2xl text-center">
              <h2 className="text-2xl font-bold text-foreground mb-4">Database Setup Required</h2>
              <p className="text-muted-foreground mb-6">
                The agents table needs to be created in Supabase. Please follow these steps:
              </p>
              
              <ol className="text-left mb-8 space-y-3">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-bold">1</span>
                  <span className="text-muted-foreground">Visit <a href="/setup" className="text-primary hover:underline">the setup page</a> to copy the SQL</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-bold">2</span>
                  <span className="text-muted-foreground">Go to <a href="https://app.supabase.com/projects" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Supabase Dashboard</a></span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-bold">3</span>
                  <span className="text-muted-foreground">Open SQL Editor and run the provided SQL</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-bold">4</span>
                  <span className="text-muted-foreground">Refresh this page</span>
                </li>
              </ol>

              <div className="flex gap-4 justify-center">
                <Link
                  href="/setup"
                  className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
                >
                  View Setup Instructions
                </Link>
                <button
                  onClick={() => window.location.reload()}
                  className="px-6 py-3 border border-border text-foreground rounded-lg font-medium hover:bg-muted transition-colors"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Other Errors */}
        {error && !loading && !error.includes('Could not find the table') && (
          <div className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-4 mb-6">
            <p className="font-medium">Error: {error}</p>
            <p className="text-sm mt-2">Please try refreshing the page or check your Supabase connection.</p>
          </div>
        )}

        {/* Empty State - 0 Agents */}
        {!loading && !error && filteredAgents.length === 0 && searchTerm === '' && agents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 min-h-[600px]">
            <div className="text-center">
              <h2 className="text-4xl font-bold text-foreground mb-4">0 Agents</h2>
              <p className="text-muted-foreground mb-8 max-w-md">
                You haven&apos;t created any trading agents yet. Start by creating your first agent to begin automated trading.
              </p>
              
              <Link
                href="/agents/create"
                className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-primary-foreground rounded-lg text-lg font-semibold hover:opacity-90 transition-opacity"
              >
                <Plus className="w-6 h-6" />
                Create Your First Agent
              </Link>
            </div>
          </div>
        )}

        {/* Empty Search Results */}
        {!loading && !error && filteredAgents.length === 0 && searchTerm !== '' && (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground mb-4">
              No agents found matching &quot;{searchTerm}&quot;
            </p>
            <button
              onClick={() => setSearchTerm('')}
              className="px-4 py-2 text-primary hover:text-primary/80 transition-colors"
            >
              Clear search
            </button>
          </div>
        )}

        {/* Agents Grid */}
        {!loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredAgents.map((agent) => {
              const roi = calculateROI(agent)
              return (
                <div
                  key={agent.id}
                  className="bg-card rounded-lg border border-border p-6 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-foreground">{agent.name}</h3>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          agent.status === 'active'
                            ? 'bg-accent/20 text-accent'
                            : agent.status === 'paused'
                            ? 'bg-secondary/20 text-secondary'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {agent.status.charAt(0).toUpperCase() + agent.status.slice(1)}
                      </span>
                      <button
                        onClick={() => handleDelete(agent.id)}
                        disabled={deleting === agent.id}
                        className="p-2 text-destructive hover:bg-destructive/10 rounded transition-colors disabled:opacity-50"
                        title="Delete agent"
                      >
                        {deleting === agent.id ? (
                          <Loader className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Trades</span>
                      <span className="text-sm font-semibold text-foreground">{agent.trade_count}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Realized PnL</span>
                      <span
                        className={`text-sm font-semibold ${
                          agent.realized_pnl >= 0 ? 'text-accent' : 'text-destructive'
                        }`}
                      >
                        {formatSol(agent.realized_pnl)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center pt-3 border-t border-border">
                      <span className="text-sm text-muted-foreground">ROI</span>
                      <span
                        className={`text-sm font-semibold ${roi >= 0 ? 'text-accent' : 'text-destructive'}`}
                      >
                        {roi >= 0 ? '+' : ''}{roi.toFixed(2)}%
                      </span>
                    </div>
                  </div>

                  <Link
                    href={`/agents/${agent.id}`}
                    className="mt-4 w-full py-2 px-3 bg-primary/10 text-primary rounded text-sm font-medium hover:bg-primary/20 transition-colors text-center block"
                  >
                    View Details
                  </Link>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
