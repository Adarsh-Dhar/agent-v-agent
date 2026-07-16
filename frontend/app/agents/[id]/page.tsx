'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Header from '@/components/header'
import { ArrowLeft, BarChart3, TrendingUp, Users, Loader } from 'lucide-react'

export default function AgentDetailPage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  const [agent, setAgent] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [id, setId] = useState<string>('')

  useEffect(() => {
    const resolveParams = async () => {
      try {
        const resolvedParams = await Promise.resolve(params)
        setId(resolvedParams.id)
      } catch (err) {
        setError('Failed to load agent')
        setLoading(false)
      }
    }
    resolveParams()
  }, [params])

  useEffect(() => {
    if (!id) return

    const fetchAgent = async () => {
      try {
        setLoading(true)
        const response = await fetch(`/api/agents/${id}`)
        
        if (!response.ok) {
          throw new Error('Agent not found')
        }

        const data = await response.json()
        setAgent(data.agent)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch agent')
        setAgent(null)
      } finally {
        setLoading(false)
      }
    }

    fetchAgent()
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex items-center justify-center min-h-screen">
          <div className="flex flex-col items-center gap-4">
            <Loader className="w-8 h-8 text-primary animate-spin" />
            <p className="text-muted-foreground">Loading agent...</p>
          </div>
        </main>
      </div>
    )
  }

  if (error || !agent) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Link href="/agents" className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors mb-8">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm font-medium">Back to Agents</span>
          </Link>
          <div className="text-center py-12">
            <p className="text-destructive text-lg">{error || 'Agent not found'}</p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link href="/agents" className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors mb-8">
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm font-medium">Back to Agents</span>
        </Link>

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">{agent.name}</h1>
            <p className="text-muted-foreground">Agent ID: {agent.id}</p>
          </div>
          <span className={`px-4 py-2 rounded-lg text-sm font-medium bg-accent/20 text-accent`}>
            Active
          </span>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Balance</span>
              <BarChart3 className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold text-foreground">${(agent.initial_purse || 0).toLocaleString()}</p>
          </div>

          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Status</span>
              <Users className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold text-foreground capitalize">{agent.signal_type || 'N/A'}</p>
          </div>

          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Risk Level</span>
              <TrendingUp className="w-4 h-4 text-accent" />
            </div>
            <p className="text-2xl font-bold text-foreground">{agent.exit_rule || 'N/A'}</p>
          </div>

          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Created</span>
              <TrendingUp className="w-4 h-4 text-accent" />
            </div>
            <p className="text-sm font-bold text-foreground">{new Date().toLocaleDateString()}</p>
          </div>
        </div>

        {/* Agent Details */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card p-6">
            <h2 className="text-xl font-bold text-foreground mb-4">Configuration</h2>
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-4 border-b border-border/30">
                <span className="text-sm text-muted-foreground">Signal Type</span>
                <span className="text-sm font-semibold text-foreground capitalize">{agent.signal_type || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center pb-4 border-b border-border/30">
                <span className="text-sm text-muted-foreground">Position Sizing</span>
                <span className="text-sm font-semibold text-foreground capitalize">{agent.position_sizing || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center pb-4 border-b border-border/30">
                <span className="text-sm text-muted-foreground">Exit Rule</span>
                <span className="text-sm font-semibold text-foreground capitalize">{agent.exit_rule || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Aggression</span>
                <span className="text-sm font-semibold text-foreground capitalize">{agent.aggression || 'N/A'}</span>
              </div>
            </div>
          </div>

          <div className="glass-card p-6">
            <h2 className="text-xl font-bold text-foreground mb-4">Actions</h2>
            <div className="space-y-3">
              <button className="w-full px-4 py-2 bg-gradient-to-r from-primary to-secondary text-background rounded-lg text-sm font-medium hover:shadow-lg hover:shadow-primary/50 transition-all">
                Edit Configuration
              </button>
              <button className="w-full px-4 py-2 border border-primary/50 text-primary rounded-lg text-sm font-medium hover:bg-primary/10 transition-colors">
                Pause Agent
              </button>
              <button className="w-full px-4 py-2 border border-destructive text-destructive rounded-lg text-sm font-medium hover:bg-destructive/10 transition-colors">
                Delete Agent
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
