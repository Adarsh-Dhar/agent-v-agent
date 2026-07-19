export function formatSol(value: number, opts: { showSign?: boolean; decimals?: number } = {}) {
  const { showSign = false, decimals = 5 } = opts
  const sign = showSign && value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)} SOL`
}
