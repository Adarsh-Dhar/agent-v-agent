'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/header'
import { ArrowLeft, Plus } from 'lucide-react'
import { useAuth } from '@/app/providers'

export default function CreateMatchPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    max_players: '4',
    initial_purse: '1000',
  })
  const [selectedAgent, setSelectedAgent] = useState<string>('')
  const [agents, setAgents] = useState<any[]>([])
  const [loadingAgents, setLoadingAgents] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchAgents = useCallback(async () => {
    try {
      setLoadingAgents(true)
      const url = new URL('/api/agents', window.location.origin)
      url.searchParams.append('userId', user?.id || '')
      
      const response = await fetch(url.toString())
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch agents')
      }

      setAgents(data.agents || [])
    } catch (err) {
      console.error('[v0] Error fetching agents:', err)
    } finally {
      setLoadingAgents(false)
    }
  }, [user])

  useEffect(() => {
    if (user?.id) {
      fetchAgents()
    }
  }, [user?.id, fetchAgents])



  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validate form inputs
    if (!formData.title || !formData.title.trim()) {
      setError('Match title is required and cannot be empty')
      return
    }

    if (formData.title.length > 255) {
      setError('Match title must be less than 255 characters')
      return
    }

    if (formData.description && formData.description.length > 1000) {
      setError('Match description must be less than 1000 characters')
      return
    }

    const maxPlayersNum = parseInt(formData.max_players)
    if (!Number.isInteger(maxPlayersNum) || maxPlayersNum < 2 || maxPlayersNum > 100) {
      setError('Max players must be between 2 and 100')
      return
    }

    const initialPurseNum = parseInt(formData.initial_purse)
    if (!Number.isInteger(initialPurseNum) || initialPurseNum < 100 || initialPurseNum > 1000000) {
      setError('Initial purse must be between 100 and 1,000,000')
      return
    }

    if (!selectedAgent) {
      setError('You must select an agent to create a match')
      return
    }

    const selectedAgentData = agents.find(a => a.id === selectedAgent)
    if (!selectedAgentData) {
      setError('Selected agent not found. Please try again.')
      return
    }

    if (!selectedAgentData.id || !selectedAgentData.name) {
      setError('Invalid agent data. Please try again.')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/matches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: formData.title.trim(),
          description: formData.description.trim(),
          max_players: maxPlayersNum,
          initial_purse: initialPurseNum,
          creator_agent_id: selectedAgentData.id,
          creator_agent_name: selectedAgentData.name,
          userId: user?.id,
          creatorName: user?.user_metadata?.name || 'Demo User',
        }),
      })

      // Handle non-JSON responses
      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Server returned invalid response format')
      }

      const data = await response.json()

      // Handle error responses
      if (!response.ok) {
        const errorMessage = data.error || `Server error: ${response.status}`
        throw new Error(errorMessage)
      }

      // Validate response data
      if (!data.match || !data.match.code) {
        throw new Error('Invalid response: Match code missing')
      }

      // Successfully created match
      router.push(`/matches/${data.match.code}`)
    } catch (err) {
      console.error('[v0] Error creating match:', err)
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred while creating the match'
      setError(errorMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link href="/matches" className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors mb-8">
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm font-medium">Back to Matches</span>
        </Link>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Match Details */}
          <div className="bg-card rounded-lg border border-border p-8 space-y-6">
            <div>
              <h2 className="text-xl font-bold text-foreground mb-6">Create a New Match</h2>
            </div>

            <div>
              <label htmlFor="title" className="block text-sm font-medium text-foreground mb-2">
                Match Title <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                id="title"
                name="title"
                value={formData.title}
                onChange={handleChange}
                placeholder="e.g., World Cup Final Trading"
                required
                className="w-full px-4 py-2 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-foreground mb-2">
                Description
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="Describe the match or competition..."
                rows={4}
                className="w-full px-4 py-2 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>

            <div>
              <label htmlFor="max_players" className="block text-sm font-medium text-foreground mb-2">
                Max Players
              </label>
              <select
                id="max_players"
                name="max_players"
                value={formData.max_players}
                onChange={handleChange}
                className="w-full px-4 py-2 bg-input border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="2">2 Players</option>
                <option value="3">3 Players</option>
                <option value="4">4 Players</option>
                <option value="6">6 Players</option>
                <option value="8">8 Players</option>
              </select>
            </div>

            <div>
              <label htmlFor="initial_purse" className="block text-sm font-medium text-foreground mb-2">
                Initial Purse Per Player
              </label>
              <input
                type="number"
                id="initial_purse"
                name="initial_purse"
                value={formData.initial_purse}
                onChange={handleChange}
                min="100"
                step="100"
                className="w-full px-4 py-2 bg-input border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Starting amount for each player"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Each player will start with this amount. Default is $1,000.
              </p>
            </div>

            <div>
              <label htmlFor="agent" className="block text-sm font-medium text-foreground mb-2">
                Select Your Agent <span className="text-destructive">*</span>
              </label>
              {loadingAgents ? (
                <div className="w-full px-4 py-2 bg-muted rounded-lg text-muted-foreground">
                  Loading agents...
                </div>
              ) : agents.length === 0 ? (
                <div className="bg-muted/50 rounded-lg p-4 border border-border mb-4">
                  <p className="text-sm text-muted-foreground mb-3">
                    You don&apos;t have any agents yet. Create one to start a match.
                  </p>
                  <Link
                    href="/agents/create"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
                  >
                    <Plus className="w-4 h-4" />
                    Create Your First Agent
                  </Link>
                </div>
              ) : (
                <select
                  id="agent"
                  value={selectedAgent}
                  onChange={(e) => {
                    setSelectedAgent(e.target.value)
                    setError(null)
                  }}
                  className="w-full px-4 py-2 bg-input border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Choose an agent...</option>
                  {agents.map(agent => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="bg-muted/50 rounded-lg p-4 border border-border">
              <p className="text-sm text-muted-foreground">
                <strong className="text-foreground">Pro Tip:</strong> You&apos;ll be added as the first player with your selected agent. Share the generated code with friends to invite them to your match.
              </p>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-4">
              {error}
            </div>
          )}

          {/* Submit Buttons */}
          <div className="bg-card rounded-lg border border-border p-8 space-y-6">
            <div className="flex gap-4">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 px-4 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isSubmitting ? 'Creating Match...' : 'Create Match'}
              </button>
              <Link
                href="/matches"
                className="flex-1 px-4 py-3 border border-border text-foreground rounded-lg font-medium hover:bg-muted transition-colors text-center"
              >
                Cancel
              </Link>
            </div>
          </div>
        </form>
      </main>
    </div>
  )
}
