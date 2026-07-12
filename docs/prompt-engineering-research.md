# Prompt Engineering Research for LLM-Reflective Strategy Layer

## Phase 1: Research Findings

### 1. System Prompt Structure in Production Systems

#### OpenAI GPT-4o Approach
- **Role-based message system** with three distinct message types: system, user, assistant
- **System message** is highest-priority context, treated as persistent instructions that take precedence over user messages
- **Recency bias**: Information at the end of the conversation receives more attention than information in the middle
- **Best practices**:
  - Front-load critical constraints in the system message
  - Repeat key instructions at the end of long prompts
  - Use JSON mode (`response_format: { type: "json_object" }`) for structured outputs
  - Use delimiters like triple backticks or XML-style tags to separate sections
  - Keep conversations short; start new sessions frequently

Source: https://aipromptarchitect.co.uk/blog/openai-vs-anthropic-structuring-prompts-for-llm-context-windows

#### Anthropic Claude Approach
- **XML-tagged documents**: Claude was specifically trained to understand XML tags as structural delimiters
- **Long document handling**: Claude's 200K context window with consistent attention across the entire context window
- **Best practices**:
  - Use XML tags extensively for structure
  - Provide complete documents rather than excerpts
  - Place instructions after the document
  - Use the `system` parameter in the API rather than embedding system instructions in the first message
  - Leverage prefilling to guide output format

Source: https://aipromptarchitect.co.uk/blog/openai-vs-anthropic-structuring-prompts-for-llm-context-windows

#### Prompt Caching Considerations
- **Anthropic**: Explicit `cache_control` markers, 90% discount on cached tokens, 5-minute cache expiration
- **OpenAI**: Automatic caching for prompts >1,024 tokens, 50% discount, cache key based on prompt prefix
- **Critical rule**: Stable content must physically precede volatile content for cache hits

Source: https://pristren.com/blog/prompt-caching-anthropic-openai-guide/

### 2. Structured Output Enforcement

#### Three-Layer Validation Stack
1. **L1: Parameter Validation Layer** - Pydantic/Zod for type coercion, missing field detection, custom validation
2. **L2: Failure Retry Layer** - Self-correction with feedback (Instructor library pattern)
3. **L3: Constrained Decoding Layer** - Token-level enforcement preventing errors at source

Source: https://eastondev.com/blog/en/posts/ai/20260506-llm-structured-output/

#### Provider-Specific Approaches

**OpenAI Structured Outputs**
- `response_format: { type: "json_schema", strict: true }`
- Failure rate: <0.1% (vs 5-10% for JSON Mode only)
- Compiles schema into grammar and constrains token sampling
- Requires `additionalProperties: false` and all fields in `required`

Source: https://crosscheck.cloud/blogs/llm-structured-output-guide/

**Anthropic Tool Use**
- Tool calling with `input_schema` and `tool_choice: { type: "tool", name: "..." }`
- No compliance guarantee even with `strict` parameter
- Must manually validate tool_use parameters with Pydantic/Zod
- Requires L1 and L2 validation layers

Source: https://eastondev.com/blog/en/posts/ai/20260506-llm-structured-output/

**Gemini Controlled Generation**
- `responseMimeType: "application/json"` + `responseSchema`
- Reliability between OpenAI and Claude (~1-2% failure rate)
- Better than JSON Mode but not reaching Strict Mode levels

Source: https://eastondev.com/blog/en/posts/ai/20260506-llm-structured-output/

#### Production Validation Pattern
```typescript
// Provider structured output = helpful first gate, not final gate
const validated = schema.parse(llmOutput);
if (!validated.success) {
  // Attempt one repair call with exact errors
  const repaired = await repairWithFeedback(llmOutput, validated.error);
  if (!repaired.success) {
    // Route to review or fallback
    return fallbackConfig;
  }
}
```

Source: https://dev.to/jackm-singularity/llm-structured-output-validation-stop-json-breaks-before-they-hit-production-1f64

### 3. Prompt Versioning and Evaluation

#### Production Tools (2026)
- **PromptLayer**: Prompt CMS, eval harness, observability stack with golden datasets
- **Braintrust**: Git-style branching and PRs, eval actions on commit/merge, per-version monitoring
- **Confident AI**: Team prompt editor, 50+ metrics, drift alerting, instant rollback

Source: https://www.promptlayer.com/, https://www.braintrust.dev/, https://www.confident-ai.com/

#### Minimal Viable Version for Hackathon Timeline
- **Version tracking**: Simple semantic versioning in prompt template files (v1.0, v1.1, etc.)
- **Regression evals**: Golden dataset of 10-20 representative trade scenarios
- **Rollback mechanism**: Environment variable `PROMPT_VERSION` to switch between versions
- **Monitoring**: Log prompt version with each LLM call, track success/failure rates

#### Mature Team Practices (Backlog)
- Automated regression tests on every prompt change
- A/B testing with traffic splitting
- Canary deployments with shadow mode
- Comprehensive drift monitoring with alerts

### 4. Guardrails Against Bad/Gamed Outputs

#### Financial/Betting Context Specifics
- **Range clamping**: Enforce min/max bounds on numeric parameters (e.g., stake percentages 1-100%)
- **Diff validation**: Compare proposed changes against previous config, flag >50% changes
- **Business rule validation**: Ensure proposed strategy respects budget cap, risk ceilings
- **Human-in-the-loop**: Require approval for first LLM-reflective change per agent

Source: https://dev.to/jackm-singularity/llm-structured-output-validation-stop-json-breaks-before-they-hit-production-1f64

#### Implementation Pattern
```typescript
function validateStrategyChange(previousConfig, proposedConfig) {
  // 1. Schema validation (L1)
  const schemaValid = validateAgentConfig(proposedConfig);
  
  // 2. Range clamping
  const clamped = clampRanges(proposedConfig);
  
  // 3. Diff validation
  const diff = computeDiff(previousConfig, clamped);
  if (diff.magnitude > 0.5) {
    return { valid: false, reason: 'Change too large, requires human approval' };
  }
  
  // 4. Business rules
  if (clamped.budget_cap !== previousConfig.budget_cap) {
    return { valid: false, reason: 'Budget cap cannot be modified by LLM' };
  }
  
  return { valid: true, config: clamped };
}
```

#### Canary/Shadow Mode
- **Shadow mode**: Run LLM-reflective strategy alongside current strategy without executing trades
- **Canary**: Deploy to 10% of agents, monitor PnL impact before full rollout
- **Minimum observation period**: 5 matches before allowing live trading

### 5. Cost/Latency Tradeoffs for Reflective Calls

#### Offline/Batch Pattern
- **Context size**: Can use full trade log (100+ trades) + match metadata
- **Reasoning**: Allow multiple samples, compare outputs, use chain-of-thought
- **Latency tolerance**: 1-5 seconds acceptable (runs once per match, not per-tick)
- **Model selection**: Use higher-quality models (Claude Opus, GPT-4) for reflective calls

#### Real-Time Signal Detection (Separate Path)
- **Must stay rule-based**: No LLM calls in the trading loop
- **Latency requirement**: <100ms per tick
- **Model selection**: Fast inference or pure logic

#### Cost Optimization
- **Prompt caching**: Cache system prompt and few-shot examples (90% discount on Anthropic)
- **Batch processing**: Process multiple agents' reflective calls together
- **Model routing**: Use cheaper models for simple cases, premium for complex

## Phase 2: Design Implications

### Recommended Approach for Agent Arena

**System Prompt Structure**: Use XML tags (Claude-native) for clarity, with explicit sections for role, constraints, examples, and output format.

**Structured Output**: Use Groq API with JSON mode + Zod validation (L1 + L2 layers). Since Groq uses open-source models, we may need to rely more on prompt-based constraints and validation rather than provider-side constrained decoding.

**Versioning**: Simple file-based versioning with environment variable switching for hackathon timeline.

**Guardrails**: Implement range clamping, diff validation, and business rule checks before any config change is applied.

**Reflective Call Pattern**: Run after match completion, with full trade log context, using higher-quality Groq model (Llama 3 70B or Mixtral 8x7B) for better reasoning.
