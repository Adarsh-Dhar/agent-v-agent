'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ExternalLink } from 'lucide-react'

export type TradeRow = {
  side: string
  odds: number
  stake: number
  reason: string | null
  pnl: number | null
  balance_after: number | null
  tx_signature: string | null
  created_at: string
}

function isSimulatedSignature(sig: string | null) {
  return !sig
}

function explorerUrl(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return iso
  }
}

export default function TradesDropdown({ trades }: { trades: TradeRow[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg border border-border hover:border-primary/50 transition-colors"
      >
        <div className="text-left">
          <p className="text-xs text-muted-foreground">Trades</p>
          <p className="font-semibold text-sm text-foreground">{trades.length}</p>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-20 mt-2 w-80 max-h-80 overflow-y-auto bg-background border border-border rounded-lg shadow-xl">
          {trades.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted-foreground">No trades yet</div>
          ) : (
            <ul className="divide-y divide-border/50">
              {trades.map((t, i) => {
                const simulated = isSimulatedSignature(t.tx_signature)
                const isClose = t.side?.startsWith('close_')
                return (
                  <li key={i} className="px-4 py-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">
                        {isClose ? 'CLOSE' : 'OPEN'} {t.side.replace('close_', '')}
                      </span>
                      <span className="text-xs text-muted-foreground">{fmtTime(t.created_at)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      stake=${Number(t.stake).toFixed(2)} @odds={Number(t.odds).toFixed(3)}
                      {t.pnl != null && (
                        <span className={t.pnl >= 0 ? 'text-accent' : 'text-destructive'}>
                          {' '}pnl={t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}
                        </span>
                      )}
                    </div>
                    <div className="mt-1">
                      {simulated ? (
                        <span className="inline-block text-[11px] px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                          simulated (no on-chain tx)
                        </span>
                      ) : (
                        <a
                          href={explorerUrl(t.tx_signature as string)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                        >
                          {t.tx_signature!.slice(0, 8)}...{t.tx_signature!.slice(-6)}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
