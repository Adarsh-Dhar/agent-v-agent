# Config Wiring Tests

Pure unit tests for the config-driven decision logic extracted from
`agentRunner.js` into `src/lib/agentDecisionRules.js` and
`src/lib/strategyEngine.js`.

## Why this exists

`agentRunner.js` imports `supabaseClient.js` and `solanaClient.js` at the
module level, both of which throw if env vars / on-chain fixtures aren't
present. That makes the decision rules impossible to test in isolation.
These tests import only the pure functions — no DB, no chain, no network.

## Run

```bash
cd server/
node --test test/configWiring.test.js
```

No third-party test frameworks. Uses Node.js built-in `node:test` and
`node:assert`.

## Coverage

| Function | Tests |
|---|---|
| `markToMarket` | 6 — buy/sell PnL, zero stake, same odds |
| `checkStopLossTakeProfit` | 5 — stop loss, take profit, within thresholds, defaults, boundary |
| `checkTimeBasedExit` | 6 — halftime, fulltime, before, between, entry after halftime |
| `passesAggressionFilter` | 13 — instant, cooldown (active/elapsed/default), confirmation (1/2/3 threshold, reset, default) |
| `getPhaseDecision` | 14 — full_match, early, pre_halftime, second_half, late_stoppage |
| `reachedMaxReentries` | 6 — null/undefined max, under/at/over cap, null trade_count |
| `applyExposureCap` | 6 — null cap, under/at/over cap, 100% cap |
| `computeDrawdownStop` | 9 — no halt, halt at/exceeds threshold, peak tracking, null peak |
| `applyReactionLatency` | 5 — enqueue, dequeue after latency, FIFO order, batch drain, default |
| `applySideBias` | 14 — none, home, away, favorite, underdog, clamping, openingState init |
| `computeContextMultiplier` | 10 — no flags, venue, weather, competition, combinations |
| `applyWildcardTrait` | 17 — chaos_agent, revenge_trader, contrarian, comeback_romantic, bandwagon, superstition, weather_prophet |
| `computeStake` (martingale) | 5 — streak doubling, balance cap, default base |
| `computeStake` (sizing) | 6 — fixed, percentage, confidence_weighted, unknown, default |
