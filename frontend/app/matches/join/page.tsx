'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/header'
import { ArrowRight, Loader } from 'lucide-react'
import { useAuth } from '@/app/providers'

function JoinMatchContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Pre-fill code if passed as query parameter
    const passedCode = searchParams.get('code')
    if (passedCode) {
      setCode(passedCode.toUpperCase())
    }
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!code.trim()) {
      setError('Please enter a match code')
      return
    }

    if (!user) {
      setError('You must be logged in to join a match')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Join the match via API
      const joinResponse = await fetch('/api/matches/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          code: code.toUpperCase(),
          userId: user.id,
          userName: user.name || user.email
        }),
      })

      const joinData = await joinResponse.json()

      if (!joinResponse.ok) {
        throw new Error(joinData.error || 'Failed to join match')
      }

      // Navigate to match after successful join
      router.push(`/matches/${code.toUpperCase()}`)
      router.refresh()
    } catch (err) {
      console.error('[v0] Error joining match:', err)
      setError(err instanceof Error ? err.message : 'Failed to join match')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-md mx-auto px-4 py-16">
        <div className="space-y-6">
          {/* Title */}
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Join a Match</h1>
            <p className="text-muted-foreground">Enter the match code to join an existing match</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-foreground mb-2">
                Match Code
              </label>
              <input
                id="code"
                type="text"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase())
                  setError(null)
                }}
                placeholder="e.g., ABC123"
                maxLength={10}
                className="w-full px-4 py-3 bg-input border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground mt-2">
                Ask your friends for their match code
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-4">
                <p className="text-sm font-medium">{error}</p>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Joining...
                </>
              ) : (
                <>
                  Join Match
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border"></div>
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-2 bg-background text-muted-foreground">or</span>
            </div>
          </div>

          {/* Link to Create Match */}
          <Link
            href="/matches/create"
            className="w-full px-6 py-3 border border-border text-foreground rounded-lg font-medium hover:bg-muted transition-colors text-center"
          >
            Create a New Match
          </Link>

          {/* Link back */}
          <Link
            href="/matches"
            className="block text-sm text-primary hover:underline text-center"
          >
            Back to Matches
          </Link>
        </div>
      </main>
    </div>
  )
}

export default function JoinMatchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><Loader className="w-8 h-8 animate-spin text-primary" /></div>}>
      <JoinMatchContent />
    </Suspense>
  )
}
