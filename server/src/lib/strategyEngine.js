// Score-State Reasoning (continuous, not event-triggered): nudges confidence
// up/down based on the live score differential and the agent's declared
// preference, independent of whether an event fired this tick.
// favor_chasing  -> boosts confidence when backing the trailing side
// favor_leading  -> boosts confidence when backing the leading side
// momentum_only  -> no score-state adjustment (pure event reaction)
export function applyScoreStateBias(agent, latest, decision) {
  const mode = agent.score_state_mode || 'momentum_only';
  if (mode === 'momentum_only' || decision.action === 'hold') return decision;

  const diff = (latest.score?.home ?? 0) - (latest.score?.away ?? 0);
  if (diff === 0) return decision; // level score, nothing to chase or lead

  const backingHome = decision.action === 'buy';
  const backingTrailingSide = (diff > 0 && !backingHome) || (diff < 0 && backingHome);

  const wantsChasing = mode === 'favor_chasing';
  const aligned = wantsChasing ? backingTrailingSide : !backingTrailingSide;

  const adjustment = aligned ? 0.15 : -0.15;
  return { ...decision, confidence: Math.max(0, Math.min(1, decision.confidence + adjustment)) };
}

// ---------------------------------------------------------------------------
// Odds-only signal family: no event/score data required at all, only a
// rolling window of `odds` values from `history`. This is the reliable path
// when live event coverage (goals/red cards) is too sparse to trade on, and
// it's what actually uses the `history` array evaluateSignal already
// receives but the event-based styles above never look at.
//
// momentum and mean_reversion (both driven off pctChange over
// odds_lookback_ticks / odds_threshold_pct) have been removed as dead
// decision styles — volatility_breakout is the only surviving member of
// this family.
// ---------------------------------------------------------------------------

function runVolatilityBreakout(agent, history) {
  const window = agent.volatility_window ?? 6;
  if (history.length <= window) return null;
  const recent = history.slice(-window).map((h) => h.odds).filter(Boolean);
  if (recent.length < window) return null;
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const variance = recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length;
  const stdev = Math.sqrt(variance);
  const latestOdds = history[history.length - 1].odds;
  const z = stdev > 0 ? (latestOdds - mean) / stdev : 0;
  const breakoutZ = agent.breakout_zscore ?? 1.5;
  if (Math.abs(z) < breakoutZ) return null;
  const action = z < 0 ? 'buy' : 'sell';
  return { action, confidence: Math.min(1, Math.abs(z) / (breakoutZ * 2)), reason: `volatility_breakout:z=${z.toFixed(2)}` };
}

function runSignal(decisionStyle, agent, history) {
  switch (decisionStyle) {
    case 'volatility_breakout':
    default:
      return runVolatilityBreakout(agent, history);
  }
}

export function evaluateSignal(agent, history) {
  if (history.length < 2) return { action: 'hold', reason: 'warming_up', confidence: 0 };

  const latest = history[history.length - 1];
  const decisionStyle = agent.decision_style || 'volatility_breakout';
  let decision = { action: 'hold', reason: 'no_signal', confidence: 0 };

  const primary = runSignal(decisionStyle, agent, history);
  decision = primary
    ? { action: primary.action, reason: primary.reason ?? `${decisionStyle}:${latest.event}`, confidence: primary.confidence }
    : { action: 'hold', reason: 'no_signal', confidence: 0 };

  // Score-State Reasoning: continuous confidence nudge based on live score diff.
  if (decision.action !== 'hold') {
    decision = applyScoreStateBias(agent, latest, decision);
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
      return Math.min(agent.fixed_stake ?? 0.05, balance);
    case 'percent_of_budget':
    case 'percentage': {
      const pct = (agent.percentage_stake ?? 10) / 100; // Convert from percentage to decimal
      return Math.min(balance * pct, balance);
    }
    case 'confidence_weighted': {
      const maxPct = (agent.percentage_stake ?? 20) / 100;
      return Math.min(balance * maxPct * confidence, balance);
    }
    case 'martingale': {
      // Risk Profile: martingale — doubles the base stake per consecutive
      // loss. lastResultStreak is threaded in by agentRunner.js (see §5);
      // computeStake stays a pure function, so the streak is passed as a
      // 3rd-ish input via agent.__martingaleStreak rather than closed-over
      // module state, to keep this file side-effect free.
      const base = agent.fixed_stake ?? 0.05;
      const streak = agent.__martingaleStreak ?? 0;
      return Math.min(base * Math.pow(2, streak), balance);
    }
    default:
      return 0;
  }
}
