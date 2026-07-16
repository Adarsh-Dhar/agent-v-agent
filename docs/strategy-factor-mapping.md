# Strategy Factor Mapping: 10-Factor Config

## Complete Factor Inventory

### 1. Market Focus

**Current Schema**: ⚠️ PARTIAL ([FEED-SHAPE TBD])
- `market_focus`: 1x2, asian_handicap, over_under, multi_market
- `ah_line_band`: tight, deep (only used when market_focus = 'asian_handicap')
- `ou_line_band`: low, mid, high (only used when market_focus = 'over_under')

**Database Columns**:
- `market_focus` TEXT ✅
- `ah_line_band` TEXT ✅
- `ou_line_band` TEXT ✅

**Notes**: 
- Currently degrades to single-odds fallback since TxLINE feed shape not yet confirmed
- Real multi-market odds array (`data.markets` / `data.superOdds`) pending API documentation
- Once feed exposes multi-market structure, `resolveMarketOdds()` in `txline.js` will filter by type + line band

---

### 2. Decision Style

**Current Schema**: ✅ FULLY IMPLEMENTED
- `decision_style`: anticipatory, confirmatory, balanced, volatility_breakout

**Database Columns**:
- `decision_style` TEXT ✅

**Notes**:
- Anticipatory fires on pre-goal buildup events (red cards) before VAR confirmation
- Confirmatory waits for confirmed events (goals, VAR'd cards, penalties)
- Balanced requires both readings to agree on direction before firing
- Volatility_breakout trades odds-only z-score breakouts over `volatility_window` / `breakout_zscore`, independent of match events
- [FEED-SHAPE TBD]: Currently keys off same `latest.event` field; true possession/shot stream pending feed upgrade
- `momentum` and `mean_reversion` were removed as dead decision styles (never wired into the DB constraint, the LLM reflection schema, the frontend presets, or the agent-generation scripts — only `validateConfig.js`/`strategyEngine.js` knew about them)

---

### 3. Confirmation Tolerance

**Current Schema**: ✅ VALIDATED (not yet wired)
- `confirmation_tolerance`: aggressive, conservative, adaptive

**Database Columns**:
- `confirmation_tolerance` TEXT ✅

**Notes**:
- Validated in `validateConfig.js` and stored in DB
- Not yet consumed by `passesAggressionFilter()` — needs follow-up diff to wire to existing `aggression`/`confirmation_threshold` columns
- Intended to scale the existing confirmation threshold (aggressive → 1, conservative → higher, adaptive → phase-dependent)

---

### 4. Match-Phase Focus

**Current Schema**: ✅ FULLY IMPLEMENTED
- `phase_weighting`: early, pre_halftime, second_half, late_stoppage, full_match

**Database Columns**:
- `phase_weighting` TEXT ✅

**Notes**:
- Replaces old 4-value enum (uniform, front_loaded, back_loaded, event_triggered) with new 5-value set
- Each mode defines stake multiplier (1.5x for active phase, 0.5x for inactive)
- Implemented in `getPhaseDecision()` in `agentRunner.js`

---

### 5. Score-State Reasoning

**Current Schema**: ✅ FULLY IMPLEMENTED
- `score_state_mode`: favor_chasing, favor_leading, momentum_only

**Database Columns**:
- `score_state_mode` TEXT ✅

**Notes**:
- Continuous confidence nudge based on live score differential, independent of event triggers
- `favor_chasing`: boosts confidence when backing the trailing side
- `favor_leading`: boosts confidence when backing the leading side
- `momentum_only`: no score-state adjustment (pure event reaction)
- Implemented in `applyScoreStateBias()` in `strategyEngine.js`

---

### 6. Team/Side Bias

**Current Schema**: ⚠️ PARTIAL ([FEED-SHAPE TBD])
- `side_bias`: home, away, favorite, underdog, none

**Database Columns**:
- `side_bias` TEXT ✅

**Notes**:
- Nudges confidence up when decision aligns with declared side
- Favorite/underdog derived from opening odds implied probability (not live odds)
- [FEED-SHAPE TBD]: Currently uses first snapshot in `history` as proxy for "opening odds" and assumes home is Participant1
- Needs real feed fields (`Participant1IsHome`, opening `Pct`) for accurate favorite/underdog detection
- Implemented in `applySideBias()` in `agentRunner.js`

---

### 7. Risk Profile

**Current Schema**: ✅ FULLY IMPLEMENTED
- `risk_profile`: conservative, aggressive, martingale, flat_stake

**Database Columns**:
- `risk_profile` TEXT ✅

**Notes**:
- Superset of existing `position_sizing` enum
- `martingale`: doubles base stake per consecutive loss (streak tracked in `agentRunner.js`)
- Other profiles pass through to existing position_sizing-derived `computeStake()`
- Martingale case flagged high-risk per spec

---

### 8. Reaction Latency

**Current Schema**: ✅ FULLY IMPLEMENTED
- `reaction_latency_ms`: numeric (0-30000)

**Database Columns**:
- `reaction_latency_ms` INTEGER ✅

**Notes**:
- Delays how long agent takes to "see" a snapshot
- Instant (0ms), Fast (2000-5000ms), Delayed (15000-30000ms)
- Implemented via queue in `applyReactionLatency()` in `agentRunner.js`
- Agent trades against snapshot that's `reaction_latency_ms` stale, simulating real-world delay

---

### 9. Context Awareness

**Current Schema**: ⚠️ PARTIAL ([FEED-SHAPE TBD])
- `context_venue_aware`: boolean
- `context_weather_aware`: boolean
- `context_competition_tier_aware`: boolean

**Database Columns**:
- `context_venue_aware` BOOLEAN ✅
- `context_weather_aware` BOOLEAN ✅
- `context_competition_tier_aware` BOOLEAN ✅

**Notes**:
- Reads venue/weather/competition-tier once at startup, applies flat confidence multiplier
- [FEED-SHAPE TBD]: No fixture-details endpoint exists yet; currently reads from optional `MOCK_FIXTURE_DETAILS` env var
- Needs real TxLINE fixture-details endpoint for production use
- Implemented in `loadContextAwareness()` in `agentRunner.js`

---

### 10. Wildcard Traits

**Current Schema**: ✅ FULLY IMPLEMENTED (except nostalgia_trader)
- `wildcard_trait`: none, chaos_agent, comeback_romantic, revenge_trader, superstition, weather_prophet, rivalry_rage, bandwagon, contrarian, last_minute_believer, nostalgia_trader

**Database Columns**:
- `wildcard_trait` TEXT ✅

**Notes**:
- Small dispatch table applied last, after all other filters/bias
- Each trait implements specific irrational behavior pattern
- `nostalgia_trader`: [FEED-SHAPE TBD] No-op until roster/lineup data available (no lineup endpoint in txline.js)
- Implemented in `applyWildcardTrait()` in `agentRunner.js`

---

## Summary Table

| Factor | Status | Database Columns | Notes |
|--------|--------|-----------------|-------|
| 1. Market Focus | ⚠️ Partial | 3 existing | Feed shape TBD for multi-market |
| 2. Decision Style | ✅ Full | 1 existing | Fully implemented |
| 3. Confirmation Tolerance | ✅ Validated | 1 existing | Not yet wired to aggression filter |
| 4. Match-Phase Focus | ✅ Full | 1 existing | New 5-phase enum |
| 5. Score-State Reasoning | ✅ Full | 1 existing | Continuous confidence nudge |
| 6. Team/Side Bias | ⚠️ Partial | 1 existing | Feed shape TBD for favorite/underdog |
| 7. Risk Profile | ✅ Full | 1 existing | Includes martingale |
| 8. Reaction Latency | ✅ Full | 1 existing | Queue-based delay |
| 9. Context Awareness | ⚠️ Partial | 3 existing | Feed shape TBD for fixture details |
| 10. Wildcard Traits | ✅ Full | 1 existing | Nostalgia trader needs roster data |

---

## Dead Columns (Left In Place)

The following columns are no longer used but left in the schema to avoid destructive migration:
- `secondary_signal_type`, `secondary_signal_threshold`
- `volatility_threshold`, `volatility_timeframe`
- `mean_reversion_threshold`
- `momentum_threshold`
- `time_decay_start`, `time_decay_end`
- `odds_lookback_ticks`, `odds_threshold_pct` — only consumed by the now-removed `momentum`/`mean_reversion` decision styles; `volatility_breakout` uses `volatility_window`/`breakout_zscore` instead

A follow-up cleanup migration can drop these once the new config has run in production.

---

## Migration Notes

### Phase Weighting Backfill Required

Before applying the new `CHECK` constraint for `phase_weighting`, existing rows must be backfilled from old values to new 5-value enum:

```sql
UPDATE public.agents SET phase_weighting = 'full_match' WHERE phase_weighting IN ('uniform','event_triggered');
UPDATE public.agents SET phase_weighting = 'early' WHERE phase_weighting = 'front_loaded';
UPDATE public.agents SET phase_weighting = 'late_stoppage' WHERE phase_weighting = 'back_loaded';
```

Run this before the `DROP CONSTRAINT` / `ADD CONSTRAINT` pair in `schema.sql`.

### Feed Shape Dependencies

Several factors are marked ⚠️ PARTIAL pending TxLINE feed shape decisions:
- Market Focus needs multi-market odds array structure
- Side Bias needs `Participant1IsHome` and opening `Pct` fields
- Context Awareness needs fixture-details endpoint
- Nostalgia Trader needs roster/lineup data

Current implementations degrade to approximations against today's single-odds/single-event feed.

### Confirmation Tolerance Wiring

`confirmation_tolerance` is validated and stored but not yet consumed by `passesAggressionFilter()`. Needs follow-up diff to wire to existing `aggression`/`confirmation_threshold` columns (aggressive → 1, conservative → higher, adaptive → phase-dependent).
