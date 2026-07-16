'use client'

import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, TrendingDown } from 'lucide-react'
import StatPill from './stat-pill'

interface AgentChartProps {
  title: string
  data: Array<{ timestamp: string; balance: number; odds: number }>
  balance: number
  realizedPnL: number
  unrealizedPnL: number
  tradeCount: number
  color: string
  gridColor?: string
  axisColor?: string
}

export default function AgentChart({
  title,
  data,
  balance,
  realizedPnL,
  unrealizedPnL,
  tradeCount,
  color,
  gridColor = 'var(--border)',
  axisColor = 'var(--muted-foreground)',
}: AgentChartProps) {
  const initialBalance = 10000
  const totalPnL = realizedPnL + unrealizedPnL
  const isPositive = totalPnL >= 0

  return (
    <div className="glass-card p-6 hover:border-primary/50 transition-all">
      <div className="mb-6">
        <h2 className="text-lg font-bold text-foreground mb-4">{title}</h2>
        
        {/* Stat Pills Row */}
        <div className="flex flex-wrap gap-3 mb-6">
          <StatPill label="Balance" value={`$${balance.toLocaleString()}`} />
          <StatPill 
            label="Realized PnL" 
            value={`${realizedPnL >= 0 ? '+' : ''}${realizedPnL}`}
            isPositive={realizedPnL >= 0}
          />
          <StatPill 
            label="Unrealized" 
            value={`${unrealizedPnL >= 0 ? '+' : ''}${unrealizedPnL}`}
            isPositive={unrealizedPnL >= 0}
          />
          <StatPill label="Trades" value={tradeCount.toString()} />
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`gradient-${title}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.4} />
              <stop offset="50%" stopColor="#8b5cf6" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" vertical={false} opacity={0.3} />
          <XAxis dataKey="timestamp" stroke="#a1a1a1" style={{ fontSize: '12px' }} />
          <YAxis stroke="#a1a1a1" style={{ fontSize: '12px' }} />
          <Tooltip 
            contentStyle={{ 
              backgroundColor: '#1a1a2e',
              border: '2px solid #a78bfa',
              borderRadius: '0.75rem',
              color: '#e5e5e5',
              fontSize: '12px',
              boxShadow: '0 0 20px rgba(167, 139, 250, 0.3)'
            }}
            formatter={(value) => `$${value.toLocaleString()}`}
            labelStyle={{ color: '#e5e5e5' }}
          />
          <Area 
            type="monotone" 
            dataKey="balance" 
            stroke="#a78bfa" 
            strokeWidth={3}
            fill={`url(#gradient-${title})`}
            isAnimationActive={true}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Footer Stats */}
      <div className="mt-6 pt-4 border-t border-border/30 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Total PnL</p>
          <div className="flex items-center gap-2">
            {isPositive ? (
              <TrendingUp className="w-4 h-4 text-primary" />
            ) : (
              <TrendingDown className="w-4 h-4 text-destructive" />
            )}
            <span className={`font-bold text-lg ${isPositive ? 'text-primary' : 'text-destructive'}`}>
              {isPositive ? '+' : ''}{totalPnL}
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground mb-1">ROI</p>
          <span className={`font-bold text-lg ${isPositive ? 'text-primary' : 'text-destructive'}`}>
            {((totalPnL / initialBalance) * 100).toFixed(2)}%
          </span>
        </div>
      </div>
    </div>
  )
}
