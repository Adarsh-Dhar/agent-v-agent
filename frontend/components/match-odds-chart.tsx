'use client'

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface MatchTick {
  minute: number
  odds: number | null
  score_home: number | null
  score_away: number | null
  event: string | null
  created_at: string
}

interface MatchOddsChartProps {
  ticks: MatchTick[]
  homeTeam?: string
  awayTeam?: string
}

export default function MatchOddsChart({ ticks, homeTeam, awayTeam }: MatchOddsChartProps) {
  const latest = ticks[ticks.length - 1]

  return (
    <div className="glass-card p-6 mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-foreground">Live Match Odds</h2>
        {latest && (
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>
              {homeTeam || 'Home'} {latest.score_home ?? 0} - {latest.score_away ?? 0} {awayTeam || 'Away'}
            </span>
            <span>Minute {latest.minute}'</span>
            {latest.event && latest.event !== '-' && (
              <span className="text-primary font-medium">{latest.event}</span>
            )}
          </div>
        )}
      </div>

      {ticks.length === 0 ? (
        <p className="text-sm text-muted-foreground py-12 text-center">
          Waiting for the first odds tick...
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={ticks} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" vertical={false} opacity={0.3} />
            <XAxis dataKey="minute" stroke="#a1a1a1" style={{ fontSize: '12px' }} tickFormatter={(m) => `${m}'`} />
            <YAxis stroke="#a1a1a1" style={{ fontSize: '12px' }} domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1a1a2e',
                border: '2px solid #a78bfa',
                borderRadius: '0.75rem',
                color: '#e5e5e5',
                fontSize: '12px',
              }}
              formatter={(value: number) => value?.toFixed ? value.toFixed(3) : value}
              labelFormatter={(m) => `Minute ${m}'`}
            />
            <Line type="monotone" dataKey="odds" stroke="#a78bfa" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
