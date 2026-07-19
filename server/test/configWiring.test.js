import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  markToMarket,
  checkStopLossTakeProfit,
  checkTimeBasedExit,
  passesAggressionFilter,
  getPhaseDecision,
  reachedMaxReentries,
  applyExposureCap,
  computeDrawdownStop,
  applyReactionLatency,
  applySideBias,
  computeContextMultiplier,
  applyWildcardTrait,
} from '../src/lib/agentDecisionRules.js';

import { computeStake } from '../src/lib/strategyEngine.js';

// ---------------------------------------------------------------------------
// markToMarket
// ---------------------------------------------------------------------------
describe('Config wiring — markToMarket', () => {
  it('buy side: positive PnL when odds drop (favored outcome)', () => {
    // entryOdds 2.0, currentOdds 1.5 => (2.0-1.5)/2.0 = 0.25 => stake * 0.25
    const pnl = markToMarket(2.0, 1.5, 'buy', 1.0);
    assert.equal(pnl, 0.25);
  });

  it('buy side: negative PnL when odds rise', () => {
    // (2.0-3.0)/2.0 = -0.5 => stake * -0.5
    const pnl = markToMarket(2.0, 3.0, 'buy', 1.0);
    assert.equal(pnl, -0.5);
  });

  it('sell side: positive PnL when odds rise', () => {
    // (3.0-2.0)/2.0 = 0.5
    const pnl = markToMarket(2.0, 3.0, 'sell', 2.0);
    assert.equal(pnl, 1.0);
  });

  it('sell side: negative PnL when odds drop', () => {
    // (1.5-2.0)/2.0 = -0.25
    const pnl = markToMarket(2.0, 1.5, 'sell', 4.0);
    assert.equal(pnl, -1.0);
  });

  it('zero stake returns zero', () => {
    assert.equal(markToMarket(2.0, 1.0, 'buy', 0), 0);
  });

  it('same odds returns zero PnL', () => {
    assert.equal(markToMarket(2.5, 2.5, 'buy', 10), 0);
  });
});

// ---------------------------------------------------------------------------
// checkStopLossTakeProfit
// ---------------------------------------------------------------------------
describe('Config wiring — checkStopLossTakeProfit', () => {
  const basePosition = { odds: 2.0, side: 'buy', stake: 1.0, entryMinute: 10 };

  it('triggers stop loss when PnL drops below -stop_loss%', () => {
    // stop_loss default = 5%. Need pnlPct <= -0.05
    // entryOdds 2.0, currentOdds ~3.0 => (2-3)/2 = -0.5 => way past -5%
    const agent = { stop_loss: 5 };
    const result = checkStopLossTakeProfit(basePosition, agent, 3.0);
    assert.equal(result.exit, true);
    assert.match(result.reason, /stop_loss/);
  });

  it('triggers take profit when PnL exceeds take_profit%', () => {
    // take_profit default = 15%. Need pnlPct >= 0.15
    // entryOdds 2.0, currentOdds 1.5 => (2-1.5)/2 = 0.25 => 25% > 15%
    const agent = { take_profit: 15 };
    const result = checkStopLossTakeProfit(basePosition, agent, 1.5);
    assert.equal(result.exit, true);
    assert.match(result.reason, /take_profit/);
  });

  it('no exit when PnL is within thresholds', () => {
    // stop_loss 20%, take_profit 30%
    // currentOdds 1.9 => (2-1.9)/2 = 0.05 => 5% which is within [-20%, +30%]
    const agent = { stop_loss: 20, take_profit: 30 };
    const result = checkStopLossTakeProfit(basePosition, agent, 1.9);
    assert.equal(result.exit, false);
  });

  it('uses default stop_loss=5 and take_profit=15 when not set', () => {
    const agent = {};
    // PnL = -50% => triggers stop_loss
    const result = checkStopLossTakeProfit(basePosition, agent, 4.0);
    assert.equal(result.exit, true);
    assert.match(result.reason, /stop_loss/);
  });

  it('stop loss triggers at exactly the threshold boundary', () => {
    // stop_loss = 10%. Need pnlPct exactly -0.10
    // entryOdds 2.0 => currentOdds = 2.0 * 1.10 = 2.2
    // pnlPct = (2.0-2.2)/2.0 = -0.10 => -10% => <= -10% => triggers
    const agent = { stop_loss: 10, take_profit: 50 };
    const result = checkStopLossTakeProfit(basePosition, agent, 2.2);
    assert.equal(result.exit, true);
    assert.match(result.reason, /stop_loss/);
  });
});

// ---------------------------------------------------------------------------
// checkTimeBasedExit
// ---------------------------------------------------------------------------
describe('Config wiring — checkTimeBasedExit', () => {
  it('halftime exit when entryMinute < 45 and currentMinute >= 45', () => {
    const position = { entryMinute: 30 };
    const result = checkTimeBasedExit(position, 45);
    assert.equal(result.exit, true);
    assert.match(result.reason, /halftime/);
  });

  it('fulltime exit when currentMinute >= 90', () => {
    const position = { entryMinute: 50 };
    const result = checkTimeBasedExit(position, 90);
    assert.equal(result.exit, true);
    assert.match(result.reason, /fulltime/);
  });

  it('no exit before halftime', () => {
    const position = { entryMinute: 10 };
    const result = checkTimeBasedExit(position, 30);
    assert.equal(result.exit, false);
  });

  it('no exit between halftime and fulltime', () => {
    const position = { entryMinute: 50 }; // entered after halftime
    const result = checkTimeBasedExit(position, 70);
    assert.equal(result.exit, false);
  });

  it('entry after halftime still triggers fulltime', () => {
    const position = { entryMinute: 60 };
    const result = checkTimeBasedExit(position, 90);
    assert.equal(result.exit, true);
    assert.match(result.reason, /fulltime/);
  });

  it('halftime check skipped when entryMinute >= 45', () => {
    // entry at 45, current 50 — not a halftime cross since entryMinute not < 45
    const position = { entryMinute: 45 };
    const result = checkTimeBasedExit(position, 50);
    assert.equal(result.exit, false);
  });
});

// ---------------------------------------------------------------------------
// passesAggressionFilter
// ---------------------------------------------------------------------------
describe('Config wiring — passesAggressionFilter', () => {
  const now = 1000000;
  const decision = { action: 'buy', confidence: 0.8 };
  const zeroStreak = { action: null, count: 0 };

  describe('instant mode (default)', () => {
    it('always passes on first signal', () => {
      const agent = {};
      const result = passesAggressionFilter(agent, decision, now, 0, zeroStreak);
      assert.equal(result.pass, true);
    });

    it('passes even immediately after a trade', () => {
      const agent = {};
      const result = passesAggressionFilter(agent, decision, now, now - 100, zeroStreak);
      assert.equal(result.pass, true);
    });

    it('explicit instant mode passes', () => {
      const agent = { aggression: 'instant' };
      const result = passesAggressionFilter(agent, decision, now, 0, zeroStreak);
      assert.equal(result.pass, true);
    });
  });

  describe('cooldown mode', () => {
    it('blocks trade when cooldown is active', () => {
      const agent = { aggression: 'cooldown', cooldown_minutes: 5 };
      const lastTrade = now - 60 * 1000; // 1 minute ago, cooldown is 5 min
      const result = passesAggressionFilter(agent, decision, now, lastTrade, zeroStreak);
      assert.equal(result.pass, false);
      assert.match(result.reason, /cooldown_active/);
    });

    it('passes when cooldown has elapsed', () => {
      const agent = { aggression: 'cooldown', cooldown_minutes: 2 };
      const lastTrade = now - 3 * 60 * 1000; // 3 min ago, cooldown is 2 min
      const result = passesAggressionFilter(agent, decision, now, lastTrade, zeroStreak);
      assert.equal(result.pass, true);
    });

    it('uses default cooldown_minutes=2 when not set', () => {
      const agent = { aggression: 'cooldown' };
      const lastTrade = now - 60 * 1000; // 1 min ago
      const result = passesAggressionFilter(agent, decision, now, lastTrade, zeroStreak);
      assert.equal(result.pass, false);
    });

    it('cooldown remaining is reported in seconds', () => {
      const agent = { aggression: 'cooldown', cooldown_minutes: 5 };
      const lastTrade = now - 2 * 60 * 1000; // 2 min ago
      const result = passesAggressionFilter(agent, decision, now, lastTrade, zeroStreak);
      assert.equal(result.pass, false);
      assert.match(result.reason, /\d+s_left/);
    });
  });

  describe('confirmation mode', () => {
    it('blocks first signal when threshold is 2', () => {
      const agent = { aggression: 'confirmation', confirmation_threshold: 2 };
      const result = passesAggressionFilter(agent, decision, now, 0, zeroStreak);
      assert.equal(result.pass, false);
      assert.match(result.reason, /awaiting_confirmation/);
    });

    it('passes on second consecutive same-direction signal', () => {
      const agent = { aggression: 'confirmation', confirmation_threshold: 2 };
      const streak = { action: 'buy', count: 1 };
      const result = passesAggressionFilter(agent, decision, now, 0, streak);
      assert.equal(result.pass, true);
      assert.equal(result.signalStreak.count, 2);
    });

    it('resets streak when signal direction changes', () => {
      const agent = { aggression: 'confirmation', confirmation_threshold: 2 };
      const streak = { action: 'buy', count: 1 };
      const sellDecision = { action: 'sell', confidence: 0.8 };
      const result = passesAggressionFilter(agent, sellDecision, now, 0, streak);
      assert.equal(result.pass, false);
      assert.equal(result.signalStreak.action, 'sell');
      assert.equal(result.signalStreak.count, 1);
    });

    it('confirmation_threshold=1 passes on first signal', () => {
      const agent = { aggression: 'confirmation', confirmation_threshold: 1 };
      const result = passesAggressionFilter(agent, decision, now, 0, zeroStreak);
      assert.equal(result.pass, true);
    });

    it('confirmation_threshold=3 requires three consecutive signals', () => {
      const agent = { aggression: 'confirmation', confirmation_threshold: 3 };
      const streak2 = { action: 'buy', count: 2 };
      const result = passesAggressionFilter(agent, decision, now, 0, streak2);
      assert.equal(result.pass, true);
      assert.equal(result.signalStreak.count, 3);
    });

    it('uses default threshold=2 when not set', () => {
      const agent = { aggression: 'confirmation' };
      const result = passesAggressionFilter(agent, decision, now, 0, zeroStreak);
      assert.equal(result.pass, false);
      assert.equal(result.signalStreak.count, 1);
    });
  });
});

// ---------------------------------------------------------------------------
// getPhaseDecision
// ---------------------------------------------------------------------------
describe('Config wiring — getPhaseDecision', () => {
  describe('full_match (default)', () => {
    it('returns multiplier 1 at any minute', () => {
      const agent = {};
      const result = getPhaseDecision(agent, { minute: 50 });
      assert.equal(result.allow, true);
      assert.equal(result.multiplier, 1);
    });

    it('explicit full_match returns 1', () => {
      const agent = { phase_weighting: 'full_match' };
      const result = getPhaseDecision(agent, { minute: 10 });
      assert.equal(result.multiplier, 1);
    });
  });

  describe('early mode', () => {
    it('multiplier 1.5 when minute <= 20', () => {
      const agent = { phase_weighting: 'early' };
      const result = getPhaseDecision(agent, { minute: 20 });
      assert.equal(result.multiplier, 1.5);
    });

    it('multiplier 0.5 when minute > 20', () => {
      const agent = { phase_weighting: 'early' };
      const result = getPhaseDecision(agent, { minute: 21 });
      assert.equal(result.multiplier, 0.5);
    });

    it('minute 0 is in early window', () => {
      const agent = { phase_weighting: 'early' };
      const result = getPhaseDecision(agent, { minute: 0 });
      assert.equal(result.multiplier, 1.5);
    });
  });

  describe('pre_halftime mode', () => {
    it('multiplier 1.5 in (20, 45]', () => {
      const agent = { phase_weighting: 'pre_halftime' };
      const result = getPhaseDecision(agent, { minute: 30 });
      assert.equal(result.multiplier, 1.5);
    });

    it('multiplier 0.5 at minute <= 20', () => {
      const agent = { phase_weighting: 'pre_halftime' };
      const result = getPhaseDecision(agent, { minute: 20 });
      assert.equal(result.multiplier, 0.5);
    });

    it('multiplier 0.5 after halftime', () => {
      const agent = { phase_weighting: 'pre_halftime' };
      const result = getPhaseDecision(agent, { minute: 50 });
      assert.equal(result.multiplier, 0.5);
    });
  });

  describe('second_half mode', () => {
    it('multiplier 1.5 in (45, 75]', () => {
      const agent = { phase_weighting: 'second_half' };
      const result = getPhaseDecision(agent, { minute: 60 });
      assert.equal(result.multiplier, 1.5);
    });

    it('multiplier 0.5 at minute 45', () => {
      const agent = { phase_weighting: 'second_half' };
      const result = getPhaseDecision(agent, { minute: 45 });
      assert.equal(result.multiplier, 0.5);
    });

    it('multiplier 0.5 after 75', () => {
      const agent = { phase_weighting: 'second_half' };
      const result = getPhaseDecision(agent, { minute: 80 });
      assert.equal(result.multiplier, 0.5);
    });
  });

  describe('late_stoppage mode', () => {
    it('multiplier 1.5 when minute > 75', () => {
      const agent = { phase_weighting: 'late_stoppage' };
      const result = getPhaseDecision(agent, { minute: 80 });
      assert.equal(result.multiplier, 1.5);
    });

    it('multiplier 0.5 at minute 75', () => {
      const agent = { phase_weighting: 'late_stoppage' };
      const result = getPhaseDecision(agent, { minute: 75 });
      assert.equal(result.multiplier, 0.5);
    });

    it('multiplier 0.5 at minute 10', () => {
      const agent = { phase_weighting: 'late_stoppage' };
      const result = getPhaseDecision(agent, { minute: 10 });
      assert.equal(result.multiplier, 0.5);
    });
  });
});

// ---------------------------------------------------------------------------
// reachedMaxReentries
// ---------------------------------------------------------------------------
describe('Config wiring — reachedMaxReentries', () => {
  it('returns false when max_reentries is null', () => {
    assert.equal(reachedMaxReentries({ max_reentries: null }), false);
  });

  it('returns false when max_reentries is undefined', () => {
    assert.equal(reachedMaxReentries({}), false);
  });

  it('returns false when trade_count < max_reentries', () => {
    assert.equal(reachedMaxReentries({ max_reentries: 5, trade_count: 4 }), false);
  });

  it('returns true when trade_count >= max_reentries', () => {
    assert.equal(reachedMaxReentries({ max_reentries: 3, trade_count: 3 }), true);
  });

  it('returns true when trade_count exceeds max_reentries', () => {
    assert.equal(reachedMaxReentries({ max_reentries: 2, trade_count: 10 }), true);
  });

  it('treats null trade_count as 0', () => {
    assert.equal(reachedMaxReentries({ max_reentries: 5, trade_count: null }), false);
  });
});

// ---------------------------------------------------------------------------
// applyExposureCap
// ---------------------------------------------------------------------------
describe('Config wiring — applyExposureCap', () => {
  it('returns stake unchanged when max_exposure_pct is null', () => {
    const agent = { balance: 10, max_exposure_pct: null };
    assert.equal(applyExposureCap(agent, 5), 5);
  });

  it('returns stake unchanged when max_exposure_pct is undefined', () => {
    const agent = { balance: 10 };
    assert.equal(applyExposureCap(agent, 5), 5);
  });

  it('caps stake when it exceeds max_exposure_pct', () => {
    // balance=10, max_exposure_pct=30 => maxStake=3
    const agent = { balance: 10, max_exposure_pct: 30 };
    assert.equal(applyExposureCap(agent, 5), 3);
  });

  it('returns stake unchanged when below cap', () => {
    const agent = { balance: 10, max_exposure_pct: 50 };
    assert.equal(applyExposureCap(agent, 3), 3);
  });

  it('returns stake when exactly at cap', () => {
    const agent = { balance: 10, max_exposure_pct: 20 };
    assert.equal(applyExposureCap(agent, 2), 2);
  });

  it('handles 100% exposure cap', () => {
    const agent = { balance: 10, max_exposure_pct: 100 };
    assert.equal(applyExposureCap(agent, 15), 10);
  });
});

// ---------------------------------------------------------------------------
// computeDrawdownStop
// ---------------------------------------------------------------------------
describe('Config wiring — computeDrawdownStop', () => {
  it('no halt when max_drawdown_stop_pct is null', () => {
    const agent = { balance: 80, max_drawdown_stop_pct: null };
    const result = computeDrawdownStop(agent, 100);
    assert.equal(result.halt, false);
  });

  it('no halt when max_drawdown_stop_pct is undefined', () => {
    const agent = { balance: 80 };
    const result = computeDrawdownStop(agent, 100);
    assert.equal(result.halt, false);
  });

  it('no halt when drawdown is below threshold', () => {
    // balance=90, peak=100 => drawdown = 10% < 20% threshold
    const agent = { balance: 90, max_drawdown_stop_pct: 20 };
    const result = computeDrawdownStop(agent, 100);
    assert.equal(result.halt, false);
    assert.equal(result.drawdownPct, 10);
  });

  it('halts when drawdown equals threshold', () => {
    // balance=80, peak=100 => drawdown = 20% == 20% threshold
    const agent = { balance: 80, max_drawdown_stop_pct: 20 };
    const result = computeDrawdownStop(agent, 100);
    assert.equal(result.halt, true);
    assert.equal(result.drawdownPct, 20);
  });

  it('halts when drawdown exceeds threshold', () => {
    // balance=50, peak=100 => drawdown = 50% > 25% threshold
    const agent = { balance: 50, max_drawdown_stop_pct: 25 };
    const result = computeDrawdownStop(agent, 100);
    assert.equal(result.halt, true);
  });

  it('peakBalance updates when current balance is higher', () => {
    const agent = { balance: 110, max_drawdown_stop_pct: 20 };
    const result = computeDrawdownStop(agent, 100);
    assert.equal(result.peakBalance, 110);
  });

  it('peakBalance stays when current balance is lower', () => {
    const agent = { balance: 90, max_drawdown_stop_pct: 20 };
    const result = computeDrawdownStop(agent, 100);
    assert.equal(result.peakBalance, 100);
  });

  it('initializes peakBalance from balance when peakBalance is null', () => {
    const agent = { balance: 85, max_drawdown_stop_pct: 20 };
    const result = computeDrawdownStop(agent, null);
    assert.equal(result.peakBalance, 85);
    assert.equal(result.halt, false); // drawdown = 0%
  });

  it('no halt when peakBalance is 0', () => {
    const agent = { balance: 0, max_drawdown_stop_pct: 20 };
    const result = computeDrawdownStop(agent, 0);
    assert.equal(result.halt, false);
  });
});

// ---------------------------------------------------------------------------
// applyReactionLatency
// ---------------------------------------------------------------------------
describe('Config wiring — applyReactionLatency', () => {
  it('queues snapshot and returns ready=null when latency not elapsed', () => {
    const agent = { reaction_latency_ms: 5000 };
    const snapshot = { odds: 2.0, minute: 10 };
    const result = applyReactionLatency(agent, snapshot, [], 1000);
    assert.equal(result.ready, null);
    assert.equal(result.pendingSnapshots.length, 1);
  });

  it('returns queued snapshot once latency has elapsed', () => {
    const agent = { reaction_latency_ms: 3000 };
    const snapshot = { odds: 2.0, minute: 10 };
    // First call at t=0 enqueues the snapshot; ready is always null for a
    // fresh entry since now - seenAt === 0.
    let result = applyReactionLatency(agent, snapshot, [], 0);
    assert.equal(result.ready, null);
    // Second call at t=5000 adds a dummy; snap1 is now old enough.
    result = applyReactionLatency(agent, { odds: 99, minute: 99 }, result.pendingSnapshots, 5000);
    assert.deepEqual(result.ready, snapshot);
  });

  it('processes queue in FIFO order — oldest comes out first', () => {
    const agent = { reaction_latency_ms: 1000 };
    const snap1 = { odds: 1.5, minute: 1 };
    const snap2 = { odds: 2.0, minute: 2 };

    // Add snap1 at t=0
    let result = applyReactionLatency(agent, snap1, [], 0);
    assert.equal(result.ready, null);

    // Add snap2 at t=500 (snap1 still queued)
    result = applyReactionLatency(agent, snap2, result.pendingSnapshots, 500);
    assert.equal(result.ready, null);

    // At t=1100, add a third snapshot; snap1 (seenAt=0) has aged, snap2 hasn't
    result = applyReactionLatency(agent, { odds: 2.5, minute: 3 }, result.pendingSnapshots, 1100);
    assert.deepEqual(result.ready, snap1);
    // Queue retains snap2 + the new snapshot
    assert.equal(result.pendingSnapshots.length, 2);
  });

  it('processes multiple ready snapshots at once (returns last)', () => {
    const agent = { reaction_latency_ms: 1000 };
    const snap1 = { odds: 1.5, minute: 1 };
    const snap2 = { odds: 2.0, minute: 2 };

    let result = applyReactionLatency(agent, snap1, [], 0);
    result = applyReactionLatency(agent, snap2, result.pendingSnapshots, 100);

    // Jump far into the future — both are ready. The while loop shifts all
    // eligible entries, keeping only the last one in `ready`.
    result = applyReactionLatency(agent, { odds: 3.0, minute: 5 }, result.pendingSnapshots, 5000);
    assert.deepEqual(result.ready, snap2);
    assert.equal(result.pendingSnapshots.length, 1); // only the newest snapshot remains
  });

  it('uses default reaction_latency_ms=3000 when not set', () => {
    const agent = {};
    const snapshot = { odds: 2.0, minute: 10 };
    const result = applyReactionLatency(agent, snapshot, [], 1000);
    assert.equal(result.ready, null); // 1000ms < 3000ms default
  });
});

// ---------------------------------------------------------------------------
// applySideBias
// ---------------------------------------------------------------------------
describe('Config wiring — applySideBias', () => {
  const history = [{ odds: 2.0 }]; // openingIsHomeFavorite = (2.0 < 1.9) = false
  const openingState = { openingOdds: null, openingIsHomeFavorite: null };
  const buyDecision = { action: 'buy', confidence: 0.5 };
  const sellDecision = { action: 'sell', confidence: 0.5 };

  describe('none mode (default)', () => {
    it('does not modify confidence', () => {
      const agent = { side_bias: 'none' };
      const result = applySideBias(agent, buyDecision, history, openingState);
      assert.equal(result.decision.confidence, 0.5);
    });

    it('does not modify hold decisions', () => {
      const agent = { side_bias: 'home' };
      const result = applySideBias(agent, { action: 'hold', confidence: 0 }, history, openingState);
      assert.equal(result.decision.action, 'hold');
    });

    it('explicitly none returns unchanged', () => {
      const agent = {};
      const result = applySideBias(agent, buyDecision, history, openingState);
      assert.equal(result.decision.confidence, 0.5);
    });
  });

  describe('home mode', () => {
    it('boosts confidence when backing home (buy)', () => {
      const agent = { side_bias: 'home' };
      const result = applySideBias(agent, buyDecision, history, openingState);
      assert.ok(result.decision.confidence > 0.5);
    });

    it('reduces confidence when backing away (sell)', () => {
      const agent = { side_bias: 'home' };
      const result = applySideBias(agent, sellDecision, history, openingState);
      assert.ok(result.decision.confidence < 0.5);
    });
  });

  describe('away mode', () => {
    it('boosts confidence when backing away (sell)', () => {
      const agent = { side_bias: 'away' };
      const result = applySideBias(agent, sellDecision, history, openingState);
      assert.ok(result.decision.confidence > 0.5);
    });

    it('reduces confidence when backing home (buy)', () => {
      const agent = { side_bias: 'away' };
      const result = applySideBias(agent, buyDecision, history, openingState);
      assert.ok(result.decision.confidence < 0.5);
    });
  });

  describe('favorite mode', () => {
    it('boosts confidence when backing favorite (buy when opening home is favorite)', () => {
      const agent = { side_bias: 'favorite' };
      const state = { openingOdds: 1.5, openingIsHomeFavorite: true };
      const result = applySideBias(agent, buyDecision, history, state);
      assert.ok(result.decision.confidence > 0.5);
    });

    it('reduces confidence when backing underdog', () => {
      const agent = { side_bias: 'favorite' };
      const state = { openingOdds: 1.5, openingIsHomeFavorite: true };
      const result = applySideBias(agent, sellDecision, history, state);
      assert.ok(result.decision.confidence < 0.5);
    });
  });

  describe('underdog mode', () => {
    it('boosts confidence when backing underdog', () => {
      const agent = { side_bias: 'underdog' };
      const state = { openingOdds: 1.5, openingIsHomeFavorite: true };
      const result = applySideBias(agent, sellDecision, history, state);
      assert.ok(result.decision.confidence > 0.5);
    });

    it('reduces confidence when backing favorite', () => {
      const agent = { side_bias: 'underdog' };
      const state = { openingOdds: 1.5, openingIsHomeFavorite: true };
      const result = applySideBias(agent, buyDecision, history, state);
      assert.ok(result.decision.confidence < 0.5);
    });
  });

  it('confidence is clamped to [0, 1] even with extreme adjustments', () => {
    const agent = { side_bias: 'home' };
    const veryLowConf = { action: 'sell', confidence: 0.05 };
    const result = applySideBias(agent, veryLowConf, history, openingState);
    assert.ok(result.decision.confidence >= 0);
    assert.ok(result.decision.confidence <= 1);
  });

  it('initializes openingState from history when openingOdds is null', () => {
    const agent = { side_bias: 'home' };
    const result = applySideBias(agent, buyDecision, history, { openingOdds: null, openingIsHomeFavorite: null });
    assert.equal(result.openingState.openingOdds, 2.0);
    // 2.0 < 1.9 is false, so openingIsHomeFavorite = false
    assert.equal(result.openingState.openingIsHomeFavorite, false);
  });

  it('does not overwrite existing openingState', () => {
    const agent = { side_bias: 'home' };
    const state = { openingOdds: 1.8, openingIsHomeFavorite: true };
    const result = applySideBias(agent, buyDecision, history, state);
    assert.equal(result.openingState.openingOdds, 1.8);
    assert.equal(result.openingState.openingIsHomeFavorite, true);
  });
});

// ---------------------------------------------------------------------------
// computeContextMultiplier
// ---------------------------------------------------------------------------
describe('Config wiring — computeContextMultiplier', () => {
  it('returns 1 when no awareness flags are set', () => {
    const agent = {};
    const fd = { venue: 'home_fortress', weather: 'rain', competitionTier: 'lower' };
    assert.equal(computeContextMultiplier(agent, fd), 1);
  });

  it('venue_aware multiplies by 1.1 for home_fortress', () => {
    const agent = { context_venue_aware: true };
    const fd = { venue: 'home_fortress' };
    assert.equal(computeContextMultiplier(agent, fd), 1.1);
  });

  it('venue_aware returns 1 for non-home_fortress venue', () => {
    const agent = { context_venue_aware: true };
    const fd = { venue: 'neutral' };
    assert.equal(computeContextMultiplier(agent, fd), 1);
  });

  it('weather_aware multiplies by 0.9 for rain', () => {
    const agent = { context_weather_aware: true };
    const fd = { weather: 'rain' };
    assert.equal(computeContextMultiplier(agent, fd), 0.9);
  });

  it('weather_aware multiplies by 0.9 for storm', () => {
    const agent = { context_weather_aware: true };
    const fd = { weather: 'storm' };
    assert.equal(computeContextMultiplier(agent, fd), 0.9);
  });

  it('weather_aware returns 1 for clear weather', () => {
    const agent = { context_weather_aware: true };
    const fd = { weather: 'clear' };
    assert.equal(computeContextMultiplier(agent, fd), 1);
  });

  it('competition_tier_aware multiplies by 0.85 for lower tier', () => {
    const agent = { context_competition_tier_aware: true };
    const fd = { competitionTier: 'lower' };
    assert.equal(computeContextMultiplier(agent, fd), 0.85);
  });

  it('competition_tier_aware returns 1 for top tier', () => {
    const agent = { context_competition_tier_aware: true };
    const fd = { competitionTier: 'top' };
    assert.equal(computeContextMultiplier(agent, fd), 1);
  });

  it('combines all three multipliers', () => {
    const agent = {
      context_venue_aware: true,
      context_weather_aware: true,
      context_competition_tier_aware: true,
    };
    const fd = { venue: 'home_fortress', weather: 'rain', competitionTier: 'lower' };
    // 1.1 * 0.9 * 0.85 = 0.8415
    const expected = 1.1 * 0.9 * 0.85;
    const result = computeContextMultiplier(agent, fd);
    assert.ok(Math.abs(result - expected) < 1e-10);
  });

  it('only venue + weather combined', () => {
    const agent = { context_venue_aware: true, context_weather_aware: true };
    const fd = { venue: 'home_fortress', weather: 'storm' };
    // 1.1 * 0.9 = 0.99
    assert.ok(Math.abs(computeContextMultiplier(agent, fd) - 0.99) < 1e-10);
  });
});

// ---------------------------------------------------------------------------
// applyWildcardTrait
// ---------------------------------------------------------------------------
describe('Config wiring — applyWildcardTrait', () => {
  const snapshot = { minute: 30, score: { home: 1, away: 0 }, odds: 2.0 };
  const history = [{ odds: 2.0 }];
  const baseDecision = { action: 'buy', confidence: 0.5, reason: 'test' };

  describe('none (default)', () => {
    it('returns decision unchanged', () => {
      const agent = {};
      const result = applyWildcardTrait(agent, baseDecision, snapshot, history, {});
      assert.deepEqual(result, baseDecision);
    });
  });

  describe('hold decisions are never modified', () => {
    it('returns hold unchanged even with chaos_agent', () => {
      const agent = { wildcard_trait: 'chaos_agent' };
      const holdDecision = { action: 'hold', confidence: 0 };
      const result = applyWildcardTrait(agent, holdDecision, snapshot, history, {});
      assert.equal(result.action, 'hold');
    });
  });

  describe('chaos_agent', () => {
    it('overrides decision when rng < 0.15', () => {
      const agent = { wildcard_trait: 'chaos_agent' };
      const fakeRng = () => 0.10; // < 0.15 => chaos fires
      const result = applyWildcardTrait(agent, baseDecision, snapshot, history, {}, fakeRng);
      assert.equal(result.action === 'buy' || result.action === 'sell', true);
      assert.match(result.reason, /chaos_agent/);
    });

    it('does not override when rng >= 0.15', () => {
      const agent = { wildcard_trait: 'chaos_agent' };
      const fakeRng = () => 0.50; // >= 0.15 => no chaos
      const result = applyWildcardTrait(agent, baseDecision, snapshot, history, {}, fakeRng);
      assert.deepEqual(result, baseDecision);
    });

    it('rng call 2 determines buy vs sell', () => {
      const agent = { wildcard_trait: 'chaos_agent' };
      let callCount = 0;
      const fakeRng = () => {
        callCount++;
        return callCount === 1 ? 0.10 : 0.3; // chaos fires, then buy path (0.3 < 0.5)
      };
      const result = applyWildcardTrait(agent, baseDecision, snapshot, history, {}, fakeRng);
      assert.equal(result.action, 'buy');
    });

    it('rng call 2 selects sell when >= 0.5', () => {
      const agent = { wildcard_trait: 'chaos_agent' };
      let callCount = 0;
      const fakeRng = () => {
        callCount++;
        return callCount === 1 ? 0.10 : 0.8; // chaos fires, then sell path
      };
      const result = applyWildcardTrait(agent, baseDecision, snapshot, history, {}, fakeRng);
      assert.equal(result.action, 'sell');
    });
  });

  describe('revenge_trader', () => {
    it('flips action when last trade was a loss and no position', () => {
      const agent = { wildcard_trait: 'revenge_trader' };
      const state = { lastTradeResult: 'loss', position: null };
      const result = applyWildcardTrait(agent, baseDecision, snapshot, history, state);
      assert.equal(result.action, 'sell');
      assert.match(result.reason, /revenge_trader/);
    });

    it('does not flip when last trade was a win', () => {
      const agent = { wildcard_trait: 'revenge_trader' };
      const state = { lastTradeResult: 'win', position: null };
      const result = applyWildcardTrait(agent, baseDecision, snapshot, history, state);
      assert.equal(result.action, 'buy');
    });

    it('does not flip when there is an open position', () => {
      const agent = { wildcard_trait: 'revenge_trader' };
      const state = { lastTradeResult: 'loss', position: { side: 'buy', stake: 1 } };
      const result = applyWildcardTrait(agent, baseDecision, snapshot, history, state);
      assert.equal(result.action, 'buy');
    });
  });

  describe('contrarian', () => {
    it('fades home favorite (sell when opening home is favorite)', () => {
      const agent = { wildcard_trait: 'contrarian' };
      const state = { openingIsHomeFavorite: true };
      const result = applyWildcardTrait(agent, baseDecision, snapshot, history, state);
      assert.equal(result.action, 'sell');
      assert.match(result.reason, /contrarian/);
    });

    it('backs home when opening away is favorite', () => {
      const agent = { wildcard_trait: 'contrarian' };
      const state = { openingIsHomeFavorite: false };
      const sellDecision = { action: 'sell', confidence: 0.5, reason: 'test' };
      const result = applyWildcardTrait(agent, sellDecision, snapshot, history, state);
      assert.equal(result.action, 'buy');
    });

    it('returns unchanged when openingIsHomeFavorite is null', () => {
      const agent = { wildcard_trait: 'contrarian' };
      const state = { openingIsHomeFavorite: null };
      const result = applyWildcardTrait(agent, baseDecision, snapshot, history, state);
      assert.deepEqual(result, baseDecision);
    });
  });

  describe('comeback_romantic', () => {
    it('does nothing before minute 60', () => {
      const agent = { wildcard_trait: 'comeback_romantic' };
      const earlySnapshot = { minute: 50, score: { home: 1, away: 2 } };
      const result = applyWildcardTrait(agent, baseDecision, earlySnapshot, history, {});
      assert.deepEqual(result, baseDecision);
    });

    it('backs trailing side after minute 60', () => {
      const agent = { wildcard_trait: 'comeback_romantic' };
      const lateSnapshot = { minute: 70, score: { home: 1, away: 2 } };
      // home is trailing (diff = -1), so trailingAction = 'buy'
      const result = applyWildcardTrait(agent, baseDecision, lateSnapshot, history, {});
      assert.equal(result.action, 'buy');
      assert.ok(result.confidence > baseDecision.confidence);
      assert.match(result.reason, /comeback_romantic/);
    });

    it('does nothing when score is level', () => {
      const agent = { wildcard_trait: 'comeback_romantic' };
      const tiedSnapshot = { minute: 70, score: { home: 1, away: 1 } };
      const result = applyWildcardTrait(agent, baseDecision, tiedSnapshot, history, {});
      assert.deepEqual(result, baseDecision);
    });
  });

  describe('bandwagon', () => {
    it('follows downward trend (buy when odds trending down)', () => {
      const agent = { wildcard_trait: 'bandwagon' };
      const recentHistory = [{ odds: 3.0 }, { odds: 2.5 }, { odds: 2.0 }];
      const result = applyWildcardTrait(agent, baseDecision, snapshot, recentHistory, {});
      assert.equal(result.action, 'buy');
      assert.match(result.reason, /bandwagon/);
    });

    it('sells when odds trending up', () => {
      const agent = { wildcard_trait: 'bandwagon' };
      const recentHistory = [{ odds: 1.5 }, { odds: 2.0 }, { odds: 3.0 }];
      const result = applyWildcardTrait(agent, baseDecision, snapshot, recentHistory, {});
      assert.equal(result.action, 'sell');
    });

    it('returns unchanged with insufficient history', () => {
      const agent = { wildcard_trait: 'bandwagon' };
      const shortHistory = [{ odds: 2.0 }];
      const result = applyWildcardTrait(agent, baseDecision, snapshot, shortHistory, {});
      assert.deepEqual(result, baseDecision);
    });
  });

  describe('superstition', () => {
    it('overrides at lucky minute', () => {
      const agent = { wildcard_trait: 'superstition' };
      const state = { luckyMinute: 30 };
      const fakeRng = () => 0.3; // buy
      const result = applyWildcardTrait(agent, baseDecision, snapshot, history, state, fakeRng);
      assert.equal(result.action, 'buy');
      assert.equal(result.confidence, 0.9);
      assert.match(result.reason, /superstition:minute_30/);
    });

    it('returns unchanged at non-lucky minute', () => {
      const agent = { wildcard_trait: 'superstition' };
      const state = { luckyMinute: 77 };
      const result = applyWildcardTrait(agent, baseDecision, snapshot, history, state);
      assert.deepEqual(result, baseDecision);
    });
  });

  describe('weather_prophet', () => {
    it('boosts confidence in rain', () => {
      const agent = { wildcard_trait: 'weather_prophet' };
      const state = { fixtureDetails: { weather: 'rain' } };
      const result = applyWildcardTrait(agent, baseDecision, snapshot, history, state);
      assert.ok(result.confidence > baseDecision.confidence);
      assert.match(result.reason, /weather_prophet/);
    });

    it('boosts confidence in storm', () => {
      const agent = { wildcard_trait: 'weather_prophet' };
      const state = { fixtureDetails: { weather: 'storm' } };
      const result = applyWildcardTrait(agent, baseDecision, snapshot, history, state);
      assert.ok(result.confidence > baseDecision.confidence);
    });

    it('returns unchanged in clear weather', () => {
      const agent = { wildcard_trait: 'weather_prophet' };
      const state = { fixtureDetails: { weather: 'clear' } };
      const result = applyWildcardTrait(agent, baseDecision, snapshot, history, state);
      assert.deepEqual(result, baseDecision);
    });
  });
});

// ---------------------------------------------------------------------------
// computeStake (from strategyEngine.js) — martingale wiring
// ---------------------------------------------------------------------------
describe('Config wiring — computeStake (martingale)', () => {
  it('martingale doubles base per consecutive loss', () => {
    const agent = {
      risk_profile: 'martingale',
      fixed_stake: 0.05,
      __martingaleStreak: 0,
    };
    const stake = computeStake(agent, 10, 0.8);
    assert.equal(stake, 0.05); // 0.05 * 2^0 = 0.05
  });

  it('martingale streak=1 doubles the base', () => {
    const agent = {
      risk_profile: 'martingale',
      fixed_stake: 0.05,
      __martingaleStreak: 1,
    };
    const stake = computeStake(agent, 10, 0.8);
    assert.equal(stake, 0.1); // 0.05 * 2^1 = 0.1
  });

  it('martingale streak=2 quadruples the base', () => {
    const agent = {
      risk_profile: 'martingale',
      fixed_stake: 0.05,
      __martingaleStreak: 2,
    };
    const stake = computeStake(agent, 10, 0.8);
    assert.equal(stake, 0.2); // 0.05 * 2^2 = 0.2
  });

  it('martingale is capped by balance', () => {
    const agent = {
      risk_profile: 'martingale',
      fixed_stake: 0.05,
      __martingaleStreak: 20,
    };
    const stake = computeStake(agent, 1.0, 0.8);
    assert.equal(stake, 1.0); // 0.05 * 2^20 >> 1.0, capped at balance
  });

  it('martingale uses default fixed_stake=0.05 when not set', () => {
    const agent = {
      risk_profile: 'martingale',
      __martingaleStreak: 0,
    };
    const stake = computeStake(agent, 10, 0.8);
    assert.equal(stake, 0.05);
  });
});

describe('Config wiring — computeStake (position_sizing)', () => {
  it('fixed sizing returns min(fixed_stake, balance)', () => {
    const agent = { position_sizing: 'fixed', fixed_stake: 0.1 };
    assert.equal(computeStake(agent, 10, 0.8), 0.1);
  });

  it('fixed sizing caps at balance when fixed_stake > balance', () => {
    const agent = { position_sizing: 'fixed', fixed_stake: 5 };
    assert.equal(computeStake(agent, 2, 0.8), 2);
  });

  it('percentage sizing returns balance * pct', () => {
    const agent = { position_sizing: 'percentage', percentage_stake: 10 };
    // 10% of 10 = 1
    assert.equal(computeStake(agent, 10, 0.8), 1);
  });

  it('confidence_weighted sizing scales by confidence', () => {
    const agent = { position_sizing: 'confidence_weighted', percentage_stake: 20 };
    // 20% * 0.5 confidence * 10 balance = 1
    assert.equal(computeStake(agent, 10, 0.5), 1);
  });

  it('unknown sizing returns 0', () => {
    const agent = { position_sizing: 'unknown_method' };
    assert.equal(computeStake(agent, 10, 0.8), 0);
  });

  it('default sizing is fixed with default stake 0.05', () => {
    const agent = {};
    assert.equal(computeStake(agent, 10, 0.8), 0.05);
  });
});
