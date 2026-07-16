import { TrendingUp, TrendingDown } from 'lucide-react'

interface StatPillProps {
  label: string
  value: string | number
  isPositive?: boolean
}

export default function StatPill({ label, value, isPositive }: StatPillProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg border border-border">
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="flex items-center gap-1">
          <p className="font-semibold text-sm text-foreground">{value}</p>
          {isPositive !== undefined && (
            isPositive ? (
              <TrendingUp className="w-3.5 h-3.5 text-accent" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5 text-destructive" />
            )
          )}
        </div>
      </div>
    </div>
  )
}
