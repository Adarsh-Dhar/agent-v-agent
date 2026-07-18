'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import Link from 'next/link'
import { Loader } from 'lucide-react'

interface AuthFormProps {
  mode: 'sign-in' | 'sign-up'
}

export default function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
    confirmPassword: '',
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value,
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (mode === 'sign-up') {
        if (formData.password !== formData.confirmPassword) {
          setError('Passwords do not match')
          setLoading(false)
          return
        }

        await authClient.signUp.email({
          email: formData.email,
          password: formData.password,
          name: formData.name,
        })
      } else {
        await authClient.signIn.email({
          email: formData.email,
          password: formData.password,
        })
      }

      // Navigate to home page - auth state will be picked up via event
      router.push('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setLoading(false)
    }
  }

  const isSignUp = mode === 'sign-up'

  return (
    <div className="glass-card p-8">
      <h1 className="text-3xl font-bold gradient-text mb-2">
        {isSignUp ? 'Create Account' : 'Sign In'}
      </h1>
      <p className="text-muted-foreground mb-8">
        {isSignUp
          ? 'Join the Agent Arena and start trading'
          : 'Welcome back to Agent Arena'}
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {isSignUp && (
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Full Name
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              className="w-full px-4 py-3 bg-background border border-border/50 rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Your name"
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Email
          </label>
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            required
            className="w-full px-4 py-3 bg-background border border-border/50 rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            placeholder="your@email.com"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Password
          </label>
          <input
            type="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            required
            className="w-full px-4 py-3 bg-background border border-border/50 rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            placeholder="••••••••"
          />
        </div>

        {isSignUp && (
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Confirm Password
            </label>
            <input
              type="password"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              required
              className="w-full px-4 py-3 bg-background border border-border/50 rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="••••••••"
            />
          </div>
        )}

        {error && (
          <div className="p-4 bg-destructive/10 border border-destructive text-destructive rounded-lg text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full px-6 py-3 bg-gradient-to-r from-primary to-secondary text-background rounded-lg font-semibold hover:shadow-lg hover:shadow-primary/50 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader className="w-4 h-4 animate-spin" />
              {isSignUp ? 'Creating Account...' : 'Signing In...'}
            </>
          ) : isSignUp ? (
            'Create Account'
          ) : (
            'Sign In'
          )}
        </button>

        <div className="text-center text-sm text-muted-foreground">
          {isSignUp ? (
            <>
              Already have an account?{' '}
              <Link href="/sign-in" className="text-primary hover:underline font-medium">
                Sign in
              </Link>
            </>
          ) : (
            <>
              Don&apos;t have an account?{' '}
              <Link href="/sign-up" className="text-primary hover:underline font-medium">
                Create one
              </Link>
            </>
          )}
        </div>
      </form>
    </div>
  )
}
