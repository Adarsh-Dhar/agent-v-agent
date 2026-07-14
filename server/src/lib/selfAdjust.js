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
    // Losing more often than not: react slower (wait for more confirmation),
    // loosen the stop, and if still anticipatory, fall back to confirmatory
    // since acting on unconfirmed events is what's likely driving the losses.
    nextConfig.reaction_latency_ms = Math.min(30000, (agent.reaction_latency_ms ?? 3000) * 1.3);
    nextConfig.stop_loss = Math.min(50, (agent.stop_loss ?? 5) * 1.1);
    if (agent.decision_style === 'anticipatory') {
      nextConfig.decision_style = 'confirmatory';
    }
  } else if (winRate > 0.6) {
    // Working well: react faster to catch more setups, and if currently
    // confirmatory, try moving to anticipatory to capture entries earlier.
    nextConfig.reaction_latency_ms = Math.max(0, (agent.reaction_latency_ms ?? 3000) * 0.8);
    if (agent.decision_style === 'confirmatory') {
      nextConfig.decision_style = 'anticipatory';
    }
  }

  return { success: true, config: nextConfig };
}
