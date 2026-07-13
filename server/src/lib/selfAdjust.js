// Non-LLM adaptivity: mechanically nudges thresholds based on recent
// realized performance. No network call, no schema-validated LLM output —
// just a small rule set applied directly to the current config.
export function selfAdjust(agent, tradeLog, performanceSummary) {
  const recentTrades = tradeLog.filter((t) => t.side.startsWith('close_')).slice(-10);
  if (recentTrades.length < 5) {
    return { success: false, error: 'not_enough_closed_trades_yet' };
  }

  const wins = recentTrades.filter((t) => Number(t.stake) > 0 && t.reason?.includes('take_profit')).length;
  const winRate = wins / recentTrades.length;

  const nextConfig = { ...agent };

  if (winRate < 0.4) {
    // Losing more often than not: tighten entry, loosen the stop.
    nextConfig.odds_threshold = Math.min(50, (agent.odds_threshold ?? 5) * 1.1);
    nextConfig.stop_loss = Math.min(50, (agent.stop_loss ?? 5) * 1.1);
  } else if (winRate > 0.6) {
    // Working well: loosen entry slightly to catch more signals.
    nextConfig.odds_threshold = Math.max(1, (agent.odds_threshold ?? 5) * 0.9);
  }

  return { success: true, config: nextConfig };
}
