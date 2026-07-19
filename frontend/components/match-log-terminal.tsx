'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal, Trophy } from 'lucide-react'
import { formatSol } from '@/lib/currency'

type Tick = {
  minute: number
  odds: number | null
  score_home: number | null
  score_away: number | null
  event: string | null
  created_at: string
}

type Trade = {
  side: string // 'buy' | 'sell' | 'close_buy' | 'close_sell'
  odds: number
  stake: number
  reason: string | null
  pnl: number | null
  balance_after: number | null
  created_at: string
}

type PlayerWithTrades = {
  id: string
  player_name: string
  agent_name: string | null
  initial_purse?: number
  agent?: { budget_cap?: number; realized_pnl?: number; unrealized_pnl?: number; trade_count?: number; balance?: number } | null
  trades?: Trade[]
}

type LogLine = {
  key: string
  ts: string
  text: string
  tone: 'tick' | 'open-buy' | 'open-sell' | 'close-win' | 'close-loss' | 'muted'
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour12: false })
  } catch {
    return ''
  }
}

function buildLines(ticks: Tick[], players: PlayerWithTrades[]): LogLine[] {
  const lines: LogLine[] = []

  ticks.forEach((t) => {
    // Live ticks encode sub-minute data as minute*100+seconds; decode for display
    const displayMinute = t.minute >= 100 ? Math.floor(t.minute / 100) : t.minute
    const oddsStr = t.odds != null ? `odds=${Number(t.odds).toFixed(3)} ` : ''
    const isError = t.event?.startsWith('error:')
    lines.push({
      key: `tick-${t.minute}-${t.created_at}`,
      ts: t.created_at,
      tone: isError ? 'close-loss' : 'tick',
      text: isError
        ? `[${displayMinute}'] ⚠ ${t.event}`
        : `[${displayMinute}'] ${oddsStr}score=${t.score_home ?? 0}-${t.score_away ?? 0} event=${t.event || '-'}`,
    })
  })

  players.forEach((p) => {
    const label = p.agent_name || p.player_name
    ;(p.trades || []).forEach((tr, i) => {
      const isClose = tr.side?.startsWith('close_')
      const side = tr.side?.replace('close_', '')
      if (!isClose) {
        lines.push({
          key: `trade-${p.id}-${i}`,
          ts: tr.created_at,
          tone: side === 'buy' ? 'open-buy' : 'open-sell',
          text: `[${label}] OPEN ${side} stake=${formatSol(Number(tr.stake))} @odds=${Number(tr.odds).toFixed(3)} reason=${tr.reason || '-'}`,
        })
      } else {
        const pnl = tr.pnl ?? 0
        const bal = tr.balance_after != null ? formatSol(Number(tr.balance_after)) : '?'
        lines.push({
          key: `trade-${p.id}-${i}`,
          ts: tr.created_at,
          tone: pnl >= 0 ? 'close-win' : 'close-loss',
          text: `[${label}] CLOSE ${side} stake=${formatSol(Number(tr.stake))} pnl=${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} -> balance=${bal} reason=${tr.reason || '-'}`,
        })
      }
    })
  })

  return lines.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
}

function toneClass(tone: LogLine['tone']) {
  switch (tone) {
    case 'tick':
      return 'text-zinc-400'
    case 'open-buy':
      return 'text-sky-400'
    case 'open-sell':
      return 'text-amber-400'
    case 'close-win':
      return 'text-emerald-400'
    case 'close-loss':
      return 'text-rose-400'
    default:
      return 'text-zinc-300'
  }
}

function buildResultsTable(players: PlayerWithTrades[]) {
  const rows = players.map((p) => {
    const trades = p.trades || []
    const closed = trades.filter((t) => t.pnl !== null && t.pnl !== undefined)
    const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length
    const budgetCap = p.agent?.budget_cap ?? p.initial_purse ?? 0.001
    const realizedPnl = p.agent?.realized_pnl ?? 0
    const finalBalance = p.agent?.balance ?? (budgetCap + realizedPnl + (p.agent?.unrealized_pnl ?? 0))
    const roi = budgetCap ? ((finalBalance - budgetCap) / budgetCap) * 100 : 0
    return {
      name: p.agent_name || p.player_name,
      trades: p.agent?.trade_count ?? trades.filter((t) => !t.side?.startsWith('close_')).length,
      wins,
      winRate: closed.length ? `${Math.round((wins / closed.length) * 100)}%` : 'n/a',
      finalBalance: formatSol(finalBalance),
      pnl: realizedPnl.toFixed(2),
      roi,
    }
  })
  rows.sort((a, b) => b.roi - a.roi)
  return rows
}

export default function MatchLogTerminal({
  ticks,
  players,
  matchStatus,
  title,
}: {
  ticks: Tick[]
  players: PlayerWithTrades[]
  matchStatus?: string
  title?: string
}) {
  const lines = useMemo(() => buildLines(ticks, players), [ticks, players])
  const results = useMemo(
    () => (matchStatus === 'completed' ? buildResultsTable(players) : null),
    [matchStatus, players]
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const [stickToBottom, setStickToBottom] = useState(true)

  useEffect(() => {
    if (!stickToBottom || !scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [lines, stickToBottom])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setStickToBottom(atBottom)
  }

  return (
    <div className="glass-card overflow-hidden mb-12 border border-border/30 rounded-lg">
      <div className="flex items-center justify-between px-4 py-3 bg-black/40 border-b border-border/30">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
          <span className="ml-3 flex items-center gap-2 text-sm text-zinc-300 font-mono">
            <Terminal className="w-4 h-4" /> {title || 'Live Match Feed'}
          </span>
        </div>
        <span className="text-xs font-mono text-zinc-500">{lines.length} lines</span>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="bg-black/80 text-xs md:text-sm font-mono px-4 py-3 h-80 overflow-y-auto leading-relaxed"
      >
        {lines.length === 0 && (
          <div className="text-zinc-500">Waiting for the first tick...</div>
        )}
        {lines.map((l) => (
          <div key={l.key} className={toneClass(l.tone)}>
            <span className="text-zinc-600 mr-2">{fmtTime(l.ts)}</span>
            {l.text}
          </div>
        ))}

        {results && (
          <div className="mt-4 border-t border-zinc-700 pt-3">
            <div className="text-zinc-400 mb-2">
              {'='.repeat(60)}
              <br />
              FINAL RESULTS
              <br />
              {'='.repeat(60)}
            </div>
            <table className="w-full text-left text-zinc-300">
              <thead className="text-zinc-500">
                <tr>
                  <th className="pr-4">name</th>
                  <th className="pr-4">trades</th>
                  <th className="pr-4">wins</th>
                  <th className="pr-4">winRate</th>
                  <th className="pr-4">finalBalance</th>
                  <th className="pr-4">pnl</th>
                  <th className="pr-4">roi</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.name}>
                    <td className="pr-4">{r.name}</td>
                    <td className="pr-4">{r.trades}</td>
                    <td className="pr-4">{r.wins}</td>
                    <td className="pr-4">{r.winRate}</td>
                    <td className="pr-4">{r.finalBalance}</td>
                    <td className="pr-4">{r.pnl}</td>
                    <td className={r.roi >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      {r.roi >= 0 ? '+' : ''}
                      {r.roi.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {results[0] && (
              <div className="mt-2 flex items-center gap-1 text-amber-300">
                <Trophy className="w-4 h-4" /> Best performer: {results[0].name} (
                {results[0].roi >= 0 ? '+' : ''}
                {results[0].roi.toFixed(2)}%, {results[0].trades} trades)
              </div>
            )}
          </div>
        )}
      </div>

      {!stickToBottom && (
        <button
          onClick={() => setStickToBottom(true)}
          className="w-full text-xs font-mono py-1.5 bg-zinc-900 text-zinc-400 hover:text-zinc-200 border-t border-border/30"
        >
          ↓ resume auto-scroll
        </button>
      )}
    </div>
  )
}
