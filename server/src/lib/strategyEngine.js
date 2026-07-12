/**
 * Given a strategy config and a rolling window of odds snapshots,
 * decide whether to buy, sell, or hold right now.
 * Returns { action: 'buy'|'sell'|'hold', reason: string, confidence: number }
 */
export function evaluateSignal(config, history) {
  if (history.length < 2) return { action: 'hold', reason: 'warming_up', confidence: 0 };

  const latest = history[history.length - 1];
  const prev = history[history.length - 2];
  const pctChange = (latest.odds - prev.odds) / prev.odds;

  const signal = config.signal.type;
  let decision = { action: 'hold', reason: 'no_signal', confidence: 0 };

  switch (signal) {
    case 'odds_movement': {
      const threshold = config.signal.threshold ?? 0.02; // 2% default
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
      if (Math.abs(pctChange) >= (config.signal.threshold ?? 0.01)) {
        decision = {
          action: pctChange > 0 ? 'buy' : 'sell', // ride the direction
          reason: `momentum:${(pctChange * 100).toFixed(1)}%`,
          confidence: Math.min(1, Math.abs(pctChange) / 0.05),
        };
      }
      break;
    }
    case 'mean_reversion': {
      if (Math.abs(pctChange) >= (config.signal.threshold ?? 0.03)) {
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
      const windowStart = config.signal.window_start ?? 85;
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
      if (variance >= (config.signal.threshold ?? 0.02)) {
        decision = { action: 'buy', reason: `volatility_spike:${variance.toFixed(3)}`, confidence: 0.6 };
      }
      break;
    }
    default:
      decision = { action: 'hold', reason: 'unknown_signal', confidence: 0 };
  }

  // Direction bias filter (long_only / short_only / bidirectional)
  const direction = config.direction ?? 'bidirectional';
  if (direction === 'long_only' && decision.action === 'sell') {
    return { action: 'hold', reason: `blocked_by_direction:${direction}`, confidence: 0 };
  }
  if (direction === 'short_only' && decision.action === 'buy') {
    return { action: 'hold', reason: `blocked_by_direction:${direction}`, confidence: 0 };
  }

  return decision;
}

/**
 * Computes stake size for a trade based on the sizing config.
 */
export function computeStake(config, balance, confidence) {
  const sizing = config.sizing.type;
  switch (sizing) {
    case 'fixed':
      return Math.min(config.sizing.amount ?? 10, balance);
    case 'percent_of_budget': {
      const pct = config.sizing.percent ?? 0.1;
      return Math.min(balance * pct, balance);
    }
    case 'confidence_weighted': {
      const maxPct = config.sizing.max_percent ?? 0.2;
      return Math.min(balance * maxPct * confidence, balance);
    }
    default:
      return 0;
  }
}
