// Pure decision-rule functions extracted from agentRunner.js.
//
// WHY THIS FILE EXISTS: agentRunner.js is a long-running script that imports
// supabaseClient.js and solanaClient.js at the top of the file, both of which
// throw at *import time* if env vars / on-chain fixtures (IDL, keypairs)
// aren't present. That makes the config-driven decision logic living inside
// agentRunner.js impossible to unit test in isolation. Everything in this
// file is copied verbatim (logic unchanged) out of agentRunner.js and made
// side-effect-free: no DB writes, no chain calls, no module-level mutable
// state. agentRunner.js now imports these instead of defining them inline.
//
// Anywhere the original function had a side effect (an `await updateRun(...)`
// or a module-level `let` it mutated), this version instead takes that state
// in as a parameter and/or returns the updated state, leaving the caller
// (agentRunner.js) responsible for persistence and for storing the returned
// state back into its own module-level variables.

const HALFTIME_MINUTE = 45;
const FULLTIME_MINUTE = 90;

// Same formula as agentRunner.js's markToMarket.
export function markToMarket(entryOdds, currentOdds, side, stake) {
  const change =
    side === 'buy' ? (entryOdds - currentOdds) / entryOdds : (currentOdds - entryOdds) / entryOdds;
  return stake * change;
}

// exit.type = 'stop_loss_take_profit' / 'stop-loss'
export function checkStopLossTakeProfit(position, agent, currentOdds) {
  const pnlPct = markToMarket(position.odds, currentOdds, position.side, position.stake) / position.stake;
  const stopLoss = (agent.stop_loss ?? 5) / 100;
  const takeProfit = (agent.take_profit ?? 15) / 100;

  if (pnlPct <= -stopLoss) {
    return { exit: true, reason: `stop_loss:${(pnlPct * 100).toFixed(1)}%` };
  }
  if (pnlPct >= takeProfit) {
    return { exit: true, reason: `take_profit:${(pnlPct * 100).toFixed(1)}%` };
  }
  return { exit: false };
}

// exit.type = 'time_based'
export function checkTimeBasedExit(position, currentMinute) {
  const crossedHalftime = position.entryMinute < HALFTIME_MINUTE && currentMinute >= HALFTIME_MINUTE;
  const crossedFulltime = currentMinute >= FULLTIME_MINUTE;
  if (crossedHalftime) return { exit: true, reason: `time_based:halftime_min_${currentMinute}` };
  if (crossedFulltime) return { exit: true, reason: `time_based:fulltime_min_${currentMinute}` };
  return { exit: false };
}

// aggression.type = 'instant' | 'confirmation' | 'cooldown'
// `signalStreak` is passed in/returned explicitly instead of living in a
// module-level `let` like the original.
export function passesAggressionFilter(agent, decision, now, lastTradeAt, signalStreak) {
  const mode = agent.aggression || 'instant';

  if (mode === 'cooldown') {
    const cooldownMs = (agent.cooldown_minutes ?? 2) * 60 * 1000;
    if (now - lastTradeAt < cooldownMs) {
      const remainingSec = Math.ceil((cooldownMs - (now - lastTradeAt)) / 1000);
      return { pass: false, reason: `cooldown_active:${remainingSec}s_left`, signalStreak };
    }
    return { pass: true, signalStreak };
  }

  if (mode === 'confirmation') {
    const threshold = agent.confirmation_threshold ?? 2;
    let nextStreak;
    if (signalStreak.action === decision.action) {
      nextStreak = { action: signalStreak.action, count: signalStreak.count + 1 };
    } else {
      nextStreak = { action: decision.action, count: 1 };
    }
    if (nextStreak.count < threshold) {
      return { pass: false, reason: `awaiting_confirmation:${nextStreak.count}/${threshold}`, signalStreak: nextStreak };
    }
    return { pass: true, signalStreak: nextStreak };
  }

  // 'instant' (default): act on the first signal
  return { pass: true, signalStreak };
}

// phase_weighting
export function getPhaseDecision(agent, snapshot) {
  const mode = agent.phase_weighting || 'full_match';
  const minute = snapshot.minute;

  if (mode === 'early') {
    if (minute <= 20) return { allow: true, multiplier: 1.5 };
    return { allow: true, multiplier: 0.5 };
  }
  if (mode === 'pre_halftime') {
    if (minute > 20 && minute <= 45) return { allow: true, multiplier: 1.5 };
    return { allow: true, multiplier: 0.5 };
  }
  if (mode === 'second_half') {
    if (minute > 45 && minute <= 75) return { allow: true, multiplier: 1.5 };
    return { allow: true, multiplier: 0.5 };
  }
  if (mode === 'late_stoppage') {
    if (minute > 75) return { allow: true, multiplier: 1.5 };
    return { allow: true, multiplier: 0.5 };
  }
  return { allow: true, multiplier: 1 }; // 'full_match' (default)
}

// max_reentries
export function reachedMaxReentries(agent) {
  return agent.max_reentries != null && (agent.trade_count ?? 0) >= agent.max_reentries;
}

// max_exposure_pct
export function applyExposureCap(agent, stake) {
  if (agent.max_exposure_pct == null) return stake;
  const maxStake = agent.balance * (agent.max_exposure_pct / 100);
  return Math.min(stake, maxStake);
}

// max_drawdown_stop_pct — pure calculation only; agentRunner.js still owns
// persisting the peak and calling updateRun({status:'stopped'}) on halt.
export function computeDrawdownStop(agent, peakBalance) {
  const newPeak = peakBalance === null ? agent.balance : Math.max(peakBalance, agent.balance);
  if (agent.max_drawdown_stop_pct == null || newPeak <= 0) {
    return { halt: false, peakBalance: newPeak, drawdownPct: 0 };
  }
  const drawdownPct = ((newPeak - agent.balance) / newPeak) * 100;
  return { halt: drawdownPct >= agent.max_drawdown_stop_pct, peakBalance: newPeak, drawdownPct };
}

// reaction_latency_ms — takes/returns the pending-snapshot queue explicitly.
export function applyReactionLatency(agent, snapshot, pendingSnapshots, now = Date.now()) {
  const queue = [...pendingSnapshots, { snapshot, seenAt: now }];
  const latencyMs = agent.reaction_latency_ms ?? 3000;

  let ready = null;
  while (queue.length && now - queue[0].seenAt >= latencyMs) {
    ready = queue.shift().snapshot;
  }
  return { ready, pendingSnapshots: queue };
}

// side_bias — takes/returns the "opening odds" memo explicitly.
export function applySideBias(agent, decision, history, openingState) {
  const bias = agent.side_bias || 'none';
  if (bias === 'none' || decision.action === 'hold') return { decision, openingState };

  let { openingOdds, openingIsHomeFavorite } = openingState;
  if (openingOdds === null && history.length > 0) {
    openingOdds = history[0].odds;
    openingIsHomeFavorite = openingOdds < 1.9;
  }

  const backingHome = decision.action === 'buy';
  let aligned = false;
  if (bias === 'home') aligned = backingHome;
  else if (bias === 'away') aligned = !backingHome;
  else if (bias === 'favorite') aligned = backingHome === openingIsHomeFavorite;
  else if (bias === 'underdog') aligned = backingHome !== openingIsHomeFavorite;

  const adjustment = aligned ? 0.1 : -0.1;
  return {
    decision: { ...decision, confidence: Math.max(0, Math.min(1, decision.confidence + adjustment)) },
    openingState: { openingOdds, openingIsHomeFavorite },
  };
}

// context_venue_aware / context_weather_aware / context_competition_tier_aware
// — split from the original loadContextAwareness: fixtureDetails
// acquisition (env var / placeholder) is the caller's job; this is just the
// multiplier math, which is what the audit actually cares about.
export function computeContextMultiplier(agent, fixtureDetails) {
  if (!agent.context_venue_aware && !agent.context_weather_aware && !agent.context_competition_tier_aware) {
    return 1;
  }
  let multiplier = 1;
  if (agent.context_venue_aware && fixtureDetails.venue === 'home_fortress') multiplier *= 1.1;
  if (agent.context_weather_aware && ['rain', 'storm'].includes(fixtureDetails.weather)) multiplier *= 0.9;
  if (agent.context_competition_tier_aware && fixtureDetails.competitionTier === 'lower') multiplier *= 0.85;
  return multiplier;
}

// wildcard_trait — `rng` defaults to Math.random but can be injected for
// deterministic tests of chaos_agent/superstition.
export function applyWildcardTrait(agent, decision, snapshot, history, state, rng = Math.random) {
  const trait = agent.wildcard_trait || 'none';
  if (trait === 'none' || decision.action === 'hold') return decision;

  const { lastTradeResult, position, openingIsHomeFavorite, fixtureDetails } = state;

  switch (trait) {
    case 'chaos_agent':
      if (rng() < 0.15) {
        return { ...decision, action: rng() < 0.5 ? 'buy' : 'sell', reason: 'chaos_agent:override' };
      }
      return decision;
    case 'comeback_romantic': {
      if (snapshot.minute < 60) return decision;
      const diff = (snapshot.score?.home ?? 0) - (snapshot.score?.away ?? 0);
      if (diff === 0) return decision;
      const trailingAction = diff > 0 ? 'sell' : 'buy';
      return { ...decision, action: trailingAction, confidence: Math.min(1, decision.confidence + 0.2), reason: 'comeback_romantic:trailing_side' };
    }
    case 'revenge_trader':
      if (lastTradeResult === 'loss' && position === null) {
        return { ...decision, action: decision.action === 'buy' ? 'sell' : 'buy', reason: 'revenge_trader:flip' };
      }
      return decision;
    case 'superstition': {
      const luckyMinute = state.luckyMinute;
      if (snapshot.minute === luckyMinute) {
        return { ...decision, action: rng() < 0.5 ? 'buy' : 'sell', confidence: 0.9, reason: `superstition:minute_${luckyMinute}` };
      }
      return decision;
    }
    case 'weather_prophet': {
      if (fixtureDetails && ['rain', 'storm'].includes(fixtureDetails.weather)) {
        return { ...decision, confidence: Math.min(1, decision.confidence + 0.3), reason: `${decision.reason}+weather_prophet` };
      }
      return decision;
    }
    case 'bandwagon': {
      const recent = history.slice(-3).map((h) => h.odds);
      if (recent.length < 2) return decision;
      const trendingDown = recent[recent.length - 1] < recent[0];
      return { ...decision, action: trendingDown ? 'buy' : 'sell', reason: 'bandwagon:follow_trend' };
    }
    case 'contrarian': {
      if (openingIsHomeFavorite === null) return decision;
      return { ...decision, action: openingIsHomeFavorite ? 'sell' : 'buy', reason: 'contrarian:fade_favorite' };
    }
    case 'last_minute_believer':
      return decision;
    default:
      return decision;
  }
}
