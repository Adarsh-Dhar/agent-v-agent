// Maps each score_state trigger event to the direction it should open.
// 'buy' = odds expected to shorten toward home (event favors the home side),
// 'sell' = odds expected to lengthen toward away (event favors the away side).
// Events with no inherent directional lean (e.g. 'penalties') are omitted on
// purpose - runSignal treats an unmapped event as no signal rather than guessing.
const SCORE_STATE_DIRECTION = {
  goal_home: 'buy',
  red_card_away: 'buy',
  goal_away: 'sell',
  red_card_home: 'sell',
};

/**
 * Given an agent with individual config columns and a rolling window of odds snapshots,
 * decide whether to buy, sell, or hold right now.
 * Returns { action: 'buy'|'sell'|'hold', reason: string, confidence: number }
 */
function runSignal(signalType, threshold, agent, history, latest, prev, pctChange) {
  // Extracted so the primary and secondary signal can both call the same
  // per-type logic without duplicating the switch statement.
  switch (signalType) {
    case 'odds-movement':
    case 'odds_movement':
      return Math.abs(pctChange) >= threshold
        ? { action: pctChange > 0 ? 'sell' : 'buy', confidence: Math.min(1, Math.abs(pctChange) / threshold) }
        : null;
    case 'momentum':
      return Math.abs(pctChange) >= threshold
        ? { action: pctChange > 0 ? 'buy' : 'sell', confidence: Math.min(1, Math.abs(pctChange) / 0.05) }
        : null;
    case 'mean_reversion':
      return Math.abs(pctChange) >= threshold
        ? { action: pctChange > 0 ? 'buy' : 'sell', confidence: Math.min(1, Math.abs(pctChange) / 0.06) }
        : null;
    case 'score_state': {
      if (!latest.event || !(agent.score_state_triggers ?? []).includes(latest.event)) return null;
      const direction = SCORE_STATE_DIRECTION[latest.event];
      // Trigger fired (e.g. 'penalties') but has no directional mapping - skip
      // rather than guess a side.
      if (!direction) return null;
      return { action: direction, confidence: 0.7 };
    }
    case 'time_decay': {
      if (latest.minute < 85) return null;
      // Late-match: back whichever side is currently leading to close out the
      // result (buy = home leading, sell = away leading). A level score has
      // no favorite to back, so no signal.
      const diff = (latest.score?.home ?? 0) - (latest.score?.away ?? 0);
      if (diff === 0) return null;
      return { action: diff > 0 ? 'buy' : 'sell', confidence: 0.5 };
    }
    case 'volatility_spike': {
      const recent = history.slice(-5).map((h) => h.odds);
      const variance =
        recent.reduce((sum, o, i, arr) => (i === 0 ? 0 : sum + Math.abs(o - arr[i - 1])), 0) / recent.length;
      if (variance < threshold) return null;
      // Trade with the direction of the move that caused the spike, i.e. a
      // breakout continuation (same convention as 'momentum').
      if (pctChange === 0) return null;
      return { action: pctChange > 0 ? 'buy' : 'sell', confidence: 0.6 };
    }
    default:
      return null;
  }
}

export function evaluateSignal(agent, history) {
  if (history.length < 2) return { action: 'hold', reason: 'warming_up', confidence: 0 };

  const latest = history[history.length - 1];
  const timeframeMin = agent.odds_timeframe ?? 5;
  // Find the oldest snapshot that is still within the configured lookback
  // window; fall back to the immediately preceding tick if history is too
  // short to cover the full timeframe yet.
  const prev =
    [...history].reverse().find((h) => h !== latest && latest.minute - h.minute >= timeframeMin) ??
    history[history.length - 2];
  const pctChange = (latest.odds - prev.odds) / prev.odds;

  const signal = agent.signal_type || 'odds-movement';
  let decision = { action: 'hold', reason: 'no_signal', confidence: 0 };

  const primary = runSignal(signal, (agent.odds_threshold ?? 5) / 100, agent, history, latest, prev, pctChange);
  decision = primary
    ? { action: primary.action, reason: `${signal}:${(pctChange * 100).toFixed(1)}%`, confidence: primary.confidence }
    : { action: 'hold', reason: 'no_signal', confidence: 0 };

  // A. Optional secondary filter: both signals must agree on direction,
  // otherwise the trade is suppressed even though the primary fired.
  if (decision.action !== 'hold' && agent.secondary_signal_type) {
    const secThreshold = (agent.secondary_signal_threshold ?? 5) / 100;
    const secondary = runSignal(agent.secondary_signal_type, secThreshold, agent, history, latest, prev, pctChange);
    if (!secondary || secondary.action !== decision.action) {
      return { action: 'hold', reason: `blocked_by_secondary:${agent.secondary_signal_type}`, confidence: 0 };
    }
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
