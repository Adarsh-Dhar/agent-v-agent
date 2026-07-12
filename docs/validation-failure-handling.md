# Validation and Failure Handling Flow for LLM-Reflective Strategy

## Overview

This document describes the complete validation and failure handling pipeline for LLM-reflective strategy updates. The goal is to ensure that no unvalidated configuration ever reaches the live trading loop.

## Three-Layer Validation Stack

### Layer 1: Schema Validation (L1)

**Purpose**: Ensure the LLM output matches our expected data structure and types.

**Implementation**: Use Zod schema validation (or equivalent) to check:
- All required fields are present
- Field types match expectations (string, number, etc.)
- Enum values are within allowed ranges
- Numeric values are within min/max bounds

**Code Pattern**:
```typescript
import { z } from 'zod';

const StrategyConfigSchema = z.object({
  signal_type: z.enum(['odds-movement', 'score_state', 'mean_reversion', 'momentum', 'time_decay', 'volatility_spike']),
  odds_threshold: z.number().min(1).max(50),
  odds_timeframe: z.number().min(1).max(60),
  position_sizing: z.enum(['fixed', 'percent_of_budget', 'confidence_weighted']),
  fixed_stake: z.number().min(10).max(1000),
  percentage_stake: z.number().min(1).max(100),
  exit_rule: z.enum(['stop_loss_take_profit', 'time_based', 'signal_reversal']),
  stop_loss: z.number().min(1).max(50),
  take_profit: z.number().min(1).max(50),
  aggression: z.enum(['instant', 'confirmation', 'cooldown']),
  cooldown_minutes: z.number().min(1).max(30),
  direction_bias: z.enum(['long_only', 'short_only', 'bidirectional']),
  justification: z.object({
    signal_type: z.string(),
    position_sizing: z.string(),
    exit_rule: z.string(),
    aggression: z.string(),
    direction_bias: z.string(),
  }),
});

function validateSchema(llmOutput: unknown) {
  return StrategyConfigSchema.safeParse(llmOutput);
}
```

**Failure Handling**: If schema validation fails, proceed to Layer 2 (retry with feedback).

---

### Layer 2: Failure Retry with Feedback (L2)

**Purpose**: Give the LLM a chance to self-correct when schema validation fails.

**Implementation**: 
1. Extract the specific validation error from L1
2. Append the error to the prompt as feedback
3. Re-call the LLM with the same context + error feedback
4. Limit to 1 retry attempt to avoid infinite loops

**Code Pattern**:
```typescript
async function reflectWithRetry(
  currentConfig: StrategyConfig,
  tradeLog: Trade[],
  performance: PerformanceSummary,
  maxRetries: number = 1
): Promise<StrategyConfig | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const prompt = buildPrompt(currentConfig, tradeLog, performance, attempt > 0 ? lastError : null);
    const llmOutput = await callGroqAPI(prompt);
    
    const validation = validateSchema(llmOutput);
    if (validation.success) {
      return validation.data;
    }
    
    if (attempt === maxRetries) {
      // Final attempt failed, log and fall back
      logError('LLM reflection failed after retries', validation.error);
      return null;
    }
    
    lastError = validation.error.format();
  }
  
  return null;
}
```

**Prompt Addition for Retry**:
```
<validation_error>
Your previous output failed validation. Please fix the following errors:
{{VALIDATION_ERROR}}

Ensure your output:
- Uses exact enum values from the schema
- Includes all required fields
- Respects numeric ranges (e.g., odds_threshold: 1-50)
- Is valid JSON with no markdown formatting
</validation_error>
```

---

### Layer 3: Business Rule and Semantic Validation (L3)

**Purpose**: Enforce domain-specific constraints that schema validation cannot catch.

**Implementation**: After successful schema validation, apply business rules:

1. **Budget Cap Immutability**: Ensure budget_cap was not modified
2. **Conservative Change Limit**: Flag changes >50% from previous value
3. **Justification Grounding**: Verify justifications reference actual metrics
4. **Risk Ceiling**: Ensure proposed config doesn't exceed risk limits

**Code Pattern**:
```typescript
function validateBusinessRules(
  previousConfig: StrategyConfig,
  proposedConfig: StrategyConfig,
  performance: PerformanceSummary
): ValidationResult {
  const errors: string[] = [];
  
  // 1. Budget cap must not change
  if (proposedConfig.budget_cap !== previousConfig.budget_cap) {
    errors.push('Budget cap cannot be modified by LLM');
  }
  
  // 2. Conservative change limit
  const changes = computeDiff(previousConfig, proposedConfig);
  for (const [key, diff] of Object.entries(changes)) {
    if (Math.abs(diff) > 0.5) {
      errors.push(`Change to ${key} is too large (${(diff * 100).toFixed(0)}%), requires human approval`);
    }
  }
  
  // 3. Justification grounding
  for (const [key, justification] of Object.entries(proposedConfig.justification)) {
    if (!justification.includes(performance.metricName)) {
      errors.push(`Justification for ${key} must reference observed metrics`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
```

**Failure Handling**: If business rule validation fails, do NOT retry. Log the failure and keep the previous config.

---

## Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Match Ends → Trigger LLM Reflection                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Build Prompt: current config + trade log + performance      │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Call Groq API with prompt                                    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Schema Validation (Zod)                            │
│ - Check required fields                                     │
│ - Check types and enums                                     │
│ - Check numeric ranges                                       │
└────────────────────────┬────────────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              │                     │
         PASS │                     │ FAIL
              │                     ▼
              │         ┌─────────────────────────────────┐
              │         │ Retry with feedback (max 1x)     │
              │         │ - Append validation error         │
              │         │ - Re-call Groq API               │
              │         └────────────────┬────────────────┘
              │                          │
              │              ┌───────────┴───────────┐
              │              │                       │
              │         PASS │                       │ FAIL
              │              │                       ▼
              │              │         ┌─────────────────────────┐
              │              │         │ Log failure             │
              │              │         │ Keep previous config    │
              │              │         └─────────────────────────┘
              │              │
              └──────────────┴──────────┐
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: Business Rule Validation                           │
│ - Budget cap immutability                                   │
│ - Conservative change limit (<50%)                           │
│ - Justification grounding                                    │
│ - Risk ceiling checks                                        │
└────────────────────────┬────────────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              │                     │
         PASS │                     │ FAIL
              │                     ▼
              │         ┌─────────────────────────────────┐
              │         │ Log failure                     │
              │         │ Keep previous config            │
              │         │ Flag for human review           │
              │         └─────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│ Apply New Config                                             │
│ - Update database                                            │
│ - Log reflection timestamp                                   │
│ - Set llm_reflection_enabled = true                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Fallback Behavior

### When All Validation Fails

1. **Keep previous config**: Never apply an unvalidated config
2. **Log the failure**: Record the error for debugging
3. **Set agent status**: Mark agent as `llm_reflection_failed`
4. **Human review flag**: Flag for manual review if multiple failures occur

### Retry Budget

- **Max retries**: 1 (total of 2 LLM calls per reflection)
- **Retry trigger**: Only schema validation failures (L1)
- **No retry for**: Business rule failures (L3) - these indicate fundamental issues

### Degradation Mode

If an agent has 3+ consecutive LLM reflection failures:
1. Disable LLM reflection for that agent
2. Set `adaptivity_mode = 'static'`
3. Log the degradation
4. Notify operator (if monitoring system exists)

---

## Error Logging

All validation failures should be logged with:

```typescript
interface ReflectionFailureLog {
  agent_id: string;
  timestamp: string;
  previous_config: StrategyConfig;
  llm_output: unknown;
  validation_layer: 'L1' | 'L2' | 'L3';
  error_message: string;
  retry_attempt: number;
}
```

Store these logs in a dedicated table for analysis:

```sql
CREATE TABLE IF NOT EXISTS reflection_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validation_layer TEXT NOT NULL,
  error_message TEXT NOT NULL,
  retry_attempt INTEGER NOT NULL,
  llm_output JSONB,
  previous_config JSONB NOT NULL
);
```

---

## Production Checklist

Before deploying LLM-reflective strategy to production:

- [ ] Schema validation (L1) implemented with Zod
- [ ] Retry logic (L2) implemented with max 1 retry
- [ ] Business rule validation (L3) implemented
- [ ] Budget cap immutability enforced
- [ ] Conservative change limit (50%) enforced
- [ ] Justification grounding checks implemented
- [ ] Fallback behavior tested (keep previous config)
- [ ] Error logging implemented
- [ ] Reflection failures table created
- [ ] Degradation mode implemented (3+ failures → disable)
- [ ] Monitoring/alerting for high failure rates
- [ ] Human review process for flagged failures

---

## Security Considerations

1. **No arbitrary code execution**: LLM output is never executed, only validated and applied as configuration
2. **SQL injection prevention**: Use parameterized queries for all database updates
3. **Rate limiting**: Limit LLM reflection calls to once per match minimum
4. **Cost controls**: Monitor Groq API costs, implement budget alerts
5. **Audit trail**: Log all reflection attempts, successes, and failures

---

## Testing Strategy

### Unit Tests
- Test schema validation with valid/invalid inputs
- Test business rule validation with edge cases
- Test retry logic with simulated failures

### Integration Tests
- Test end-to-end reflection flow with mock Groq API
- Test database updates after successful reflection
- Test fallback behavior after failures

### Golden Dataset
- Create 10-20 representative trade scenarios
- Test reflection against each scenario
- Verify outputs are reasonable and grounded

### Regression Tests
- Before deploying prompt changes, run against golden dataset
- Ensure new prompt doesn't break existing scenarios
- Track success rate over time
