/**
 * Given an agent with individual config columns and a rolling window of odds snapshots,
 * decide whether to buy, sell, or hold right now.
 * Returns { action: 'buy'|'sell'|'hold', reason: string, confidence: number }
 */
export function evaluateSignal(agent, history) {
  if (history.length < 2) return { action: 'hold', reason: 'warming_up', confidence: 0 };

  const latest = history[history.length - 1];
  const prev = history[history.length - 2];
  const pctChange = (latest.odds - prev.odds) / prev.odds;

  const signal = agent.signal_type || 'odds-movement';
  let decision = { action: 'hold', reason: 'no_signal', confidence: 0 };

  switch (signal) {
    case 'odds-movement':
    case 'odds_movement': {
      const threshold = (agent.odds_threshold ?? 5) / 100; // Convert from percentage to decimal
      if (Math.abs(pctChange) >= threshold) {
        decision = {
          action: pctChange > 0 ? 'sell' : 'buy',
          reason: `odds_movement:${(pctChange * 100).toFixed(1)}%`,
          confidence: Math.min(1, Math.abs(pctChange) / threshold),
        };
      }
      break;
    }
    case 'momentum': {
      if (Math.abs(pctChange) >= ((agent.odds_threshold ?? 5) / 100)) {
        decision = {
          action: pctChange > 0 ? 'buy' : 'sell', // ride the direction
          reason: `momentum:${(pctChange * 100).toFixed(1)}%`,
          confidence: Math.min(1, Math.abs(pctChange) / 0.05),
        };
      }
      break;
    }
    case 'mean_reversion': {
      if (Math.abs(pctChange) >= ((agent.odds_threshold ?? 5) / 100)) {
        decision = {
          action: pctChange > 0 ? 'buy' : 'sell', // bet against the swing
          reason: `mean_reversion:${(pctChange * 100).toFixed(1)}%`,
          confidence: Math.min(1, Math.abs(pctChange) / 0.06),
        };
      }
      break;
    }
    case 'score_state': {
      if (latest.event) {
        decision = { action: 'buy', reason: `score_state:${latest.event}`, confidence: 0.7 };
      }
      break;
    }
    case 'time_decay': {
      const windowStart = 85;
      if (latest.minute >= windowStart) {
        decision = { action: 'buy', reason: `time_decay:min_${latest.minute}`, confidence: 0.5 };
      }
      break;
    }
    case 'volatility_spike': {
      const recent = history.slice(-5).map((h) => h.odds);
      const variance =
        recent.reduce((sum, o, i, arr) => (i === 0 ? 0 : sum + Math.abs(o - arr[i - 1])), 0) /
        recent.length;
      if (variance >= ((agent.odds_threshold ?? 5) / 100)) {
        decision = { action: 'buy', reason: `volatility_spike:${variance.toFixed(3)}`, confidence: 0.6 };
      }
      break;
    }
    default:
      decision = { action: 'hold', reason: 'unknown_signal', confidence: 0 };
  }

  // Direction bias filter (long_only / short_only / bidirectional)
  const direction = agent.direction_bias ?? 'bidirectional';
  if (direction === 'long_only' && decision.action === 'sell') {
    return { action: 'hold', reason: `blocked_by_direction:${direction}`, confidence: 0 };
  }
  if (direction === 'short_only' && decision.action === 'buy') {
    return { action: 'hold', reason: `blocked_by_direction:${direction}`, confidence: 0 };
  }

  return decision;
}

/**
 * Computes stake size for a trade based on the sizing config columns.
 */
export function computeStake(agent, balance, confidence) {
  const sizing = agent.position_sizing || 'fixed';
  switch (sizing) {
    case 'fixed':
      return Math.min(agent.fixed_stake ?? 100, balance);
    case 'percent_of_budget':
    case 'percentage': {
      const pct = (agent.percentage_stake ?? 10) / 100; // Convert from percentage to decimal
      return Math.min(balance * pct, balance);
    }
    case 'confidence_weighted': {
      const maxPct = (agent.percentage_stake ?? 20) / 100;
      return Math.min(balance * maxPct * confidence, balance);
    }
    default:
      return 0;
  }
}
