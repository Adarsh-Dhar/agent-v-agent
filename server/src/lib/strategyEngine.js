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

// Maps each score_state trigger event to the direction it should open.
// 'buy' = odds expected to shorten toward home (event favors the home side),
// 'sell' = odds expected to lengthen toward away (event favors the away side).
// Events with no inherent directional lean (e.g. 'penalties') are omitted on
// purpose - unmapped events are treated as no signal rather than a guess.
const SCORE_STATE_DIRECTION = {
  goal_home: 'buy',
  red_card_away: 'buy',
  goal_away: 'sell',
  red_card_home: 'sell',
};

// Buildup events that count toward an "anticipatory" pre-goal signal.
// [FEED-SHAPE TBD]: today's feed only emits a flattened `event` string per
// tick (see mockTxlineFeed.js / txlineReplay.js), not a possession/shot
// stream. Until the feed carries `possessionType` / `Action` per tick, this
// keys off the same `latest.event` field score_state already uses, treating
// certain events as "buildup adjacent" is not possible — so anticipatory
// mode currently degrades to firing one tick earlier than confirmatory would
// by watching for `latest.event === 'red_card_away' || 'red_card_home'`
// (immediate, un-VAR'd) rather than a true pre-goal possession signal.
// Replace ANTICIPATORY_EVENTS with real possession-streak detection once the
// feed exposes it.
const ANTICIPATORY_EVENTS = new Set(['red_card_home', 'red_card_away']);
const CONFIRMATORY_EVENTS = new Set(['goal_home', 'goal_away', 'red_card_home', 'red_card_away', 'penalties']);

function runAnticipatory(agent, latest) {
  if (!latest.event || !ANTICIPATORY_EVENTS.has(latest.event)) return null;
  const direction = SCORE_STATE_DIRECTION[latest.event];
  if (!direction) return null;
  // Higher confidence ceiling than confirmatory since it's still un-realized —
  // Confirmation Tolerance (see agentRunner.js) is what actually gates risk.
  return { action: direction, confidence: 0.55 };
}

function runConfirmatory(agent, latest) {
  if (!latest.event || !CONFIRMATORY_EVENTS.has(latest.event)) return null;
  const direction = SCORE_STATE_DIRECTION[latest.event];
  if (!direction) return null; // e.g. 'penalties' has no directional lean
  return { action: direction, confidence: 0.8 };
}

function runBalanced(agent, latest) {
  const anticipatory = runAnticipatory(agent, latest);
  const confirmatory = runConfirmatory(agent, latest);
  // Balanced requires both readings to agree on direction before firing —
  // mirrors the existing primary/secondary agreement pattern below.
  if (!anticipatory || !confirmatory || anticipatory.action !== confirmatory.action) return null;
  return { action: confirmatory.action, confidence: (anticipatory.confidence + confirmatory.confidence) / 2 };
}

function runSignal(decisionStyle, agent, latest) {
  switch (decisionStyle) {
    case 'anticipatory':
      return runAnticipatory(agent, latest);
    case 'confirmatory':
      return runConfirmatory(agent, latest);
    case 'balanced':
    default:
      return runBalanced(agent, latest);
  }
}

export function evaluateSignal(agent, history) {
  if (history.length < 2) return { action: 'hold', reason: 'warming_up', confidence: 0 };

  const latest = history[history.length - 1];
  const decisionStyle = agent.decision_style || 'balanced';
  let decision = { action: 'hold', reason: 'no_signal', confidence: 0 };

  const primary = runSignal(decisionStyle, agent, latest);
  decision = primary
    ? { action: primary.action, reason: `${decisionStyle}:${latest.event}`, confidence: primary.confidence }
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
    case 'martingale': {
      // Risk Profile: martingale — doubles the base stake per consecutive
      // loss. lastResultStreak is threaded in by agentRunner.js (see §5);
      // computeStake stays a pure function, so the streak is passed as a
      // 3rd-ish input via agent.__martingaleStreak rather than closed-over
      // module state, to keep this file side-effect free.
      const base = agent.fixed_stake ?? 100;
      const streak = agent.__martingaleStreak ?? 0;
      return Math.min(base * Math.pow(2, streak), balance);
    }
    default:
      return 0;
  }
}
