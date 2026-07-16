'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Header from '@/components/header'
import { Copy, Check } from 'lucide-react'

export default function SetupPage() {
  const [copied, setCopied] = useState(false)
  const [sqlCode, setSqlCode] = useState('')

  useEffect(() => {
    // Fetch the SQL from the API
    const fetchSetupInstructions = async () => {
      try {
        const response = await fetch('/api/setup')
        const data = await response.json()
        if (data.sql) {
          setSqlCode(data.sql)
        }
      } catch (err) {
        console.error('Error fetching setup instructions:', err)
      }
    }

    fetchSetupInstructions()
  }, [])

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(sqlCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-card rounded-lg border border-border p-8 space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Database Setup</h1>
            <p className="text-muted-foreground">Create the required tables in your Supabase database</p>
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-foreground">Instructions:</h2>
            <ol className="space-y-3">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                  1
                </span>
                <span className="text-foreground">
                  Go to <a href="https://app.supabase.com/projects" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    Supabase Projects
                  </a>
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                  2
                </span>
                <span className="text-foreground">Select your project (tzcnntxptekcaapbibee)</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                  3
                </span>
                <span className="text-foreground">Click <strong>SQL Editor</strong> in the left sidebar</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                  4
                </span>
                <span className="text-foreground">Click <strong>New Query</strong></span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                  5
                </span>
                <span className="text-foreground">Copy the SQL code below and paste it into the query editor</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                  6
                </span>
                <span className="text-foreground">Click <strong>Run</strong> to execute the query</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                  7
                </span>
                <span className="text-foreground">Return here and click <strong>Verify Setup</strong></span>
              </li>
            </ol>
          </div>

          {/* SQL Code Block */}
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-foreground">SQL Code:</h2>
            <div className="relative bg-muted/50 border border-border rounded-lg overflow-hidden">
              <button
                onClick={copyToClipboard}
                className="absolute top-2 right-2 p-2 bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity"
                title="Copy to clipboard"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
              <pre className="p-4 overflow-x-auto text-sm text-foreground font-mono">
                {sqlCode}
              </pre>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-4 pt-4">
            <a
              href="https://app.supabase.com/projects"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity text-center"
            >
              Open Supabase
            </a>
            <Link
              href="/agents"
              className="flex-1 px-4 py-2 border border-border text-foreground rounded-lg font-medium hover:bg-muted transition-colors text-center"
            >
              Back to Agents
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
