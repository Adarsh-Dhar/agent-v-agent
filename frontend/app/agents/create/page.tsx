'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Header from '@/components/header'
import Link from 'next/link'
import { ArrowLeft, Check } from 'lucide-react'
import { useAuth } from '@/app/providers'
import { AGENT_PRESETS } from '@/lib/agent-presets'

export default function CreateAgentPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [agentName, setAgentName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!selectedPreset) {
      setError('Please select an agent preset')
      return
    }

    if (!agentName.trim()) {
      setError('Please enter an agent name')
      return
    }

    const preset = AGENT_PRESETS.find(p => p.id === selectedPreset)
    if (!preset) {
      setError('Invalid preset selected')
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          owner: user?.id,
          config: {
            name: agentName,
            description: preset.description,
            market_focus: preset.marketFocus,
            decision_style: preset.decisionStyle,
            confirmation_tolerance: 'adaptive',
            side_bias: preset.sideBias,
            reaction_latency_ms: preset.reactionLatencyMs,
            context_venue_aware: preset.contextVenueAware,
            context_weather_aware: preset.contextWeatherAware,
            wildcard_trait: preset.wildcardTrait,
            sizing: {
              type: preset.positionSizing,
              percentage: 10,
              fixed_stake: 100,
              confidence_weighted: preset.positionSizing === 'confidence_weighted',
            },
            exit: {
              type: 'stop_loss_take_profit',
              stop_loss: 5,
              take_profit: 15,
            },
            aggression: {
              type: preset.confirmationTolerance,
              cooldown_minutes: 2,
              confirmation_threshold: 2,
            },
            direction: 'bidirectional',
            target_selection: 'both',
            phase_weighting: preset.phaseWeighting,
            reentry_rule: 'capped_reentry',
            max_reentries: 5,
            portfolio_behavior: 'independent',
            adaptivity: 'static',
          },
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create agent')
      }

      router.push('/agents')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <Link
          href="/agents"
          className="inline-flex items-center gap-2 text-foreground/70 hover:text-foreground mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Agents
        </Link>

        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Create New Agent</h1>
          <p className="text-foreground/60">
            Choose a trading strategy preset and customize it with your own name
          </p>
        </div>

        <form onSubmit={handleCreateAgent}>
          {/* Agent Name Input */}
          <div className="mb-8 bg-card rounded-lg p-6 border border-border">
            <label className="block text-sm font-medium mb-2">Agent Name</label>
            <input
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="e.g., My Aggressive Trader"
              className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-xs text-foreground/50 mt-2">
              Give your agent a unique name to identify it in matches
            </p>
          </div>

          {/* Presets Grid */}
          <div className="mb-8">
            <label className="block text-sm font-medium mb-4">Select Strategy Preset</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {AGENT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSelectedPreset(preset.id)}
                  className={`p-4 rounded-lg border-2 transition-all text-left ${
                    selectedPreset === preset.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-card hover:border-primary/50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="font-semibold text-foreground">{preset.name}</h3>
                      <p className="text-xs text-foreground/60 mt-1">{preset.description}</p>
                    </div>
                    {selectedPreset === preset.id && (
                      <Check className="w-5 h-5 text-primary flex-shrink-0" />
                    )}
                  </div>

                  {/* Preset Details */}
                  <div className="mt-3 space-y-1 text-xs text-foreground/70">
                    <div className="flex justify-between">
                      <span>Market:</span>
                      <span className="font-medium capitalize">{preset.marketFocus.replace('_', ' ')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Style:</span>
                      <span className="font-medium capitalize">{preset.decisionStyle}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Phase:</span>
                      <span className="font-medium capitalize">{preset.phaseWeighting.replace('_', ' ')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Reaction:</span>
                      <span className="font-medium">{preset.reactionLatencyMs}ms</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          {/* Submit Button */}
          <div className="flex gap-4">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Creating Agent...' : 'Create Agent'}
            </button>
            <Link
              href="/agents"
              className="px-6 py-3 border border-border rounded-lg font-medium hover:bg-card transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      </main>
    </div>
  )
}
