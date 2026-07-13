# Strategy Factor Mapping: MVP vs Stretch Status

## Complete Factor Inventory (A-F, H-I, K-L)

### A. Signal (when to buy/sell) — primary + optional secondary filter

**Current MVP Schema**: ✅ PARTIALLY IMPLEMENTED
- `signal_type`: odds-movement, score_state, mean_reversion, momentum, time_decay, volatility_spike
- `odds_threshold`: numeric (1-50)
- `odds_timeframe`: numeric (1-60)

**Missing from MVP**:
- Secondary signal filter (not yet implemented)
- Signal-specific parameters (e.g., window_start for time_decay)

**Database Columns**:
- `signal_type` TEXT ✅
- `odds_threshold` NUMERIC ✅
- `odds_timeframe` INTEGER ✅
- `secondary_signal_type` TEXT ❌ (stretch)
- `secondary_signal_threshold` NUMERIC ❌ (stretch)

---

### B. Position Sizing

**Current MVP Schema**: ✅ PARTIALLY IMPLEMENTED
- `position_sizing`: fixed, percent_of_budget, confidence_weighted
- `fixed_stake`: numeric (10-1000)
- `percentage_stake`: numeric (1-100)

**Database Columns**:
- `position_sizing` TEXT ✅
- `fixed_stake` NUMERIC ✅
- `percentage_stake` NUMERIC ✅

---

### C. Exit Rule

**Current MVP Schema**: ✅ PARTIALLY IMPLEMENTED
- `exit_rule`: stop_loss_take_profit, time_based, signal_reversal
- `stop_loss`: numeric (1-50)
- `take_profit`: numeric (1-50)

**Missing from MVP**:
- Time-based exit parameters (halftime, fulltime, custom minutes)
- Exit trigger conditions

**Database Columns**:
- `exit_rule` TEXT ✅
- `stop_loss` NUMERIC ✅
- `take_profit` NUMERIC ✅
- `time_based_exit_minutes` INTEGER ❌ (stretch)
- `time_based_exit_trigger` TEXT ❌ (stretch)

---

### D. Aggression / Timing

**Current MVP Schema**: ✅ PARTIALLY IMPLEMENTED
- `aggression`: instant, confirmation, cooldown
- `cooldown_minutes`: numeric (1-30)

**Database Columns**:
- `aggression` TEXT ✅
- `cooldown_minutes` INTEGER ✅

---

### E. Budget Cap

**Current MVP Schema**: ✅ FULLY IMPLEMENTED
- `budget_cap`: numeric (fixed constraint, LLM cannot modify)

**Database Columns**:
- `budget_cap` NUMERIC ✅

**Note**: This is a game rule, not a strategy variant. The LLM must NEVER modify this.

---

### F. Direction Bias

**Current MVP Schema**: ✅ FULLY IMPLEMENTED
- `direction_bias`: long_only, short_only, bidirectional

**Database Columns**:
- `direction_bias` TEXT ✅

---

### H. Match-Phase Weighting (STRETCH - NOT IN MVP)

**Options**:
1. uniform
2. front_loaded
3. back_loaded
4. event_triggered

**Database Columns**:
- `match_phase_weighting` TEXT ❌ (stretch)
- `front_loaded_minutes` INTEGER ❌ (stretch)
- `back_loaded_minutes` INTEGER ❌ (stretch)
- `event_triggers` TEXT[] ❌ (stretch)

**Status**: BACKLOG - Advanced feature for multi-phase strategies

---

### I. Re-entry Rule (STRETCH - NOT IN MVP)

**Options**:
1. no_reentry
2. immediate_reentry
3. capped_reentry

**Database Columns**:
- `reentry_rule` TEXT ❌ (stretch)
- `max_trades_per_match` INTEGER ❌ (stretch)

**Status**: BACKLOG - Current implementation allows unlimited re-entry

---

### K. Adaptivity

**Current MVP Schema**: ✅ PARTIALLY IMPLEMENTED
- This is the mechanism itself (LLM-reflective mode)

**Database Columns**:
- `adaptivity_mode` TEXT ❌ (needs to be added)
- `llm_reflection_enabled` BOOLEAN ❌ (needs to be added)
- `last_reflection_timestamp` TIMESTAMPTZ ❌ (needs to be added)

**Status**: IN PROGRESS - This is the current task being implemented

**Enum Values**:
- static
- self_adjusting
- llm_reflective

---

### L. Risk Ceiling (STRETCH - NOT IN MVP)

**Options**:
1. none
2. max_drawdown_stop
3. max_exposure_cap

**Database Columns**:
- `risk_ceiling` TEXT ❌ (stretch)
- `max_drawdown_percent` NUMERIC ❌ (stretch)
- `max_exposure_cap` NUMERIC ❌ (stretch)

**Status**: BACKLOG - Important for production, but not MVP

---

## Summary Table

| Factor | MVP Status | Database Columns | Notes |
|--------|-----------|-----------------|-------|
| A. Signal | ✅ Partial | 3 existing, 2 stretch | Secondary signal is stretch |
| B. Position Sizing | ✅ Complete | 3 existing | Fully implemented |
| C. Exit Rule | ✅ Partial | 3 existing, 2 stretch | Time-based parameters are stretch |
| D. Aggression | ✅ Complete | 2 existing | Fully implemented |
| E. Budget Cap | ✅ Complete | 1 existing | Fixed constraint, immutable |
| F. Direction Bias | ✅ Complete | 1 existing | Fully implemented |
| H. Match-Phase Weighting | ❌ Stretch | 0 existing, 4 stretch | Backlog |
| I. Re-entry Rule | ❌ Stretch | 0 existing, 2 stretch | Backlog |
| K. Adaptivity | 🔄 In Progress | 0 existing, 3 needed | Current task |
| L. Risk Ceiling | ❌ Stretch | 0 existing, 3 stretch | Backlog |

---

## MVP Subset (A-D + F + K)

**Factors in MVP**: A, B, C, D, E, F, K
**Total Strategy Space**: ~3,402 strategies
- Signals: 6 options
- Sizing: 3 options
- Exit: 3 options
- Aggression: 3 options
- Direction: 3 options
- Adaptivity: 3 options (static, self-adjusting, llm_reflective)

**Stretch Factors (Backlog)**: H, I, L

---

## Database Schema Additions Needed for MVP Completion

To complete the MVP with LLM-reflective adaptivity (K), we need to add:

```sql
ALTER TABLE public.agents
ADD COLUMN IF NOT EXISTS adaptivity_mode TEXT DEFAULT 'static',
ADD COLUMN IF NOT EXISTS llm_reflection_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS last_reflection_timestamp TIMESTAMPTZ;
```

**Constraint**: `adaptivity_mode` must be one of: 'static', 'self_adjusting', 'llm_reflective'

---

## Prompt Template Coverage

The prompt template (`reflectiveStrategy.md`) currently covers:
- ✅ A: Signal (signal_type, odds_threshold, odds_timeframe)
- ✅ B: Position Sizing (position_sizing, fixed_stake, percentage_stake)
- ✅ C: Exit Rule (exit_rule, stop_loss, take_profit)
- ✅ D: Aggression (aggression, cooldown_minutes)
- ✅ E: Budget Cap (read-only, immutable)
- ✅ F: Direction Bias (direction_bias)
- ✅ K: Adaptivity (implicit through the reflective process itself)

**Not covered in prompt** (stretch factors):
- ❌ H: Match-Phase Weighting
- ❌ I: Re-entry Rule
- ❌ L: Risk Ceiling

The prompt is designed to be extensible - when stretch factors are added to the schema, they can be added to the prompt template without restructuring.
