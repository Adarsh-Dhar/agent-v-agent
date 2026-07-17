import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Groq from 'groq-sdk';
import { z } from 'zod';
import { supabase } from './supabaseClient.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = path.join(__dirname, 'prompts', 'reflectiveStrategy.md');

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Zod schema for LLM output validation
const StrategyConfigSchema = z.object({
  market_focus: z.enum(['1x2', 'asian_handicap', 'over_under', 'multi_market']),
  decision_style: z.enum(['volatility_breakout']),
  confirmation_tolerance: z.enum(['aggressive', 'conservative', 'adaptive']),
  score_state_mode: z.enum(['favor_chasing', 'favor_leading', 'momentum_only']),
  side_bias: z.enum(['home', 'away', 'favorite', 'underdog', 'none']),
  reaction_latency_ms: z.number().min(0).max(30000),
  position_sizing: z.enum(['fixed', 'percent_of_budget', 'confidence_weighted']),
  fixed_stake: z.number().min(0.01).max(10),
  percentage_stake: z.number().min(1).max(100),
  exit_rule: z.enum(['stop_loss_take_profit', 'time_based', 'signal_reversal']),
  stop_loss: z.number().min(1).max(50),
  take_profit: z.number().min(1).max(50),
  aggression: z.enum(['instant', 'confirmation', 'cooldown']),
  cooldown_minutes: z.number().min(1).max(30),
  direction_bias: z.enum(['long_only', 'short_only', 'bidirectional']),
  justification: z.object({
    decision_style: z.string(),
    position_sizing: z.string(),
    exit_rule: z.string(),
    aggression: z.string(),
    direction_bias: z.string(),
  }),
});

function log(...msg) {
  console.log('[llmReflection]', ...msg);
}

function loadPromptTemplate() {
  if (!fs.existsSync(PROMPT_PATH)) {
    throw new Error(`Prompt template not found at ${PROMPT_PATH}`);
  }
  return fs.readFileSync(PROMPT_PATH, 'utf8');
}

function buildPrompt(currentConfig, tradeLog, performanceSummary, validationError = null) {
  let prompt = loadPromptTemplate();

  // Replace placeholders with actual data
  prompt = prompt.replace('{{MARKET_FOCUS}}', currentConfig.market_focus || '1x2');
  prompt = prompt.replace('{{DECISION_STYLE}}', currentConfig.decision_style || 'volatility_breakout');
  prompt = prompt.replace('{{CONFIRMATION_TOLERANCE}}', currentConfig.confirmation_tolerance || 'adaptive');
  prompt = prompt.replace('{{SCORE_STATE_MODE}}', currentConfig.score_state_mode || 'momentum_only');
  prompt = prompt.replace('{{SIDE_BIAS}}', currentConfig.side_bias || 'none');
  prompt = prompt.replace('{{REACTION_LATENCY_MS}}', currentConfig.reaction_latency_ms ?? 3000);
  prompt = prompt.replace('{{POSITION_SIZING}}', currentConfig.position_sizing || 'fixed');
  prompt = prompt.replace('{{FIXED_STAKE}}', currentConfig.fixed_stake || 0.05);
  prompt = prompt.replace('{{PERCENTAGE_STAKE}}', currentConfig.percentage_stake || 10);
  prompt = prompt.replace('{{EXIT_RULE}}', currentConfig.exit_rule || 'signal_reversal');
  prompt = prompt.replace('{{STOP_LOSS}}', currentConfig.stop_loss || 5);
  prompt = prompt.replace('{{TAKE_PROFIT}}', currentConfig.take_profit || 15);
  prompt = prompt.replace('{{AGGRESSION}}', currentConfig.aggression || 'instant');
  prompt = prompt.replace('{{COOLDOWN_MINUTES}}', currentConfig.cooldown_minutes || 2);
  prompt = prompt.replace('{{DIRECTION_BIAS}}', currentConfig.direction_bias || 'bidirectional');
  prompt = prompt.replace('{{BUDGET_CAP}}', currentConfig.budget_cap || 500);
  prompt = prompt.replace('{{TRADE_LOG}}', JSON.stringify(tradeLog, null, 2));
  prompt = prompt.replace('{{TOTAL_TRADES}}', performanceSummary.total_trades || 0);
  prompt = prompt.replace('{{WINNING_TRADES}}', performanceSummary.winning_trades || 0);
  prompt = prompt.replace('{{LOSING_TRADES}}', performanceSummary.losing_trades || 0);
  prompt = prompt.replace('{{REALIZED_PNL}}', performanceSummary.realized_pnl || 0);
  prompt = prompt.replace('{{UNREALIZED_PNL}}', performanceSummary.unrealized_pnl || 0);
  prompt = prompt.replace('{{FINAL_BALANCE}}', performanceSummary.final_balance || 0);
  prompt = prompt.replace('{{ROI_PERCENT}}', performanceSummary.roi_percent || 0);
  prompt = prompt.replace('{{AVG_HOLD_TIME_MINUTES}}', performanceSummary.avg_hold_time_minutes || 0);
  prompt = prompt.replace('{{MAX_DRAWDOWN_PERCENT}}', performanceSummary.max_drawdown_percent || 0);

  // Add validation error if retrying
  if (validationError) {
    const errorSection = `
<validation_error>
Your previous output failed validation. Please fix the following errors:
${validationError}

Ensure your output:
- Uses exact enum values from the schema
- Includes all required fields
- Respects numeric ranges (e.g., reaction_latency_ms: 0-30000)
- Is valid JSON with no markdown formatting
</validation_error>
`;
    prompt = prompt.replace('</performance_summary>', `</performance_summary>${errorSection}`);
  }

  return prompt;
}

async function callGroqAPI(prompt) {
  try {
    const response = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'You are a JSON-only API. Respond with valid JSON only, no markdown, no explanation.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.3,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content;
    return JSON.parse(content);
  } catch (error) {
    log('Groq API call failed:', error.message);
    throw error;
  }
}

function validateSchema(llmOutput) {
  return StrategyConfigSchema.safeParse(llmOutput);
}

function validateBusinessRules(previousConfig, proposedConfig, performanceSummary) {
  const errors = [];

  // 1. Budget cap must not change
  if (proposedConfig.budget_cap !== undefined && proposedConfig.budget_cap !== previousConfig.budget_cap) {
    errors.push('Budget cap cannot be modified by LLM');
  }

  // 2. Strategy factor is locked at agent creation. The reflection's job is
  // profit-maximizing parameter tuning within that factor, not switching it.
  // decision_style/market_focus/side_bias are the agent's new fixed identity.
  const lockedFields = ['decision_style', 'market_focus', 'side_bias', 'position_sizing', 'exit_rule', 'aggression', 'direction_bias'];
  for (const field of lockedFields) {
    if (proposedConfig[field] !== undefined && previousConfig[field] !== undefined && proposedConfig[field] !== previousConfig[field]) {
      errors.push(`${field} is a locked strategy factor and cannot be changed (was '${previousConfig[field]}', got '${proposedConfig[field]}')`);
    }
  }

  // 3. Conservative change limit (<50%)
  const numericFields = ['reaction_latency_ms', 'fixed_stake', 'percentage_stake', 'stop_loss', 'take_profit', 'cooldown_minutes'];
  for (const field of numericFields) {
    if (proposedConfig[field] !== undefined && previousConfig[field] !== undefined) {
      const diff = (proposedConfig[field] - previousConfig[field]) / previousConfig[field];
      if (Math.abs(diff) > 0.5) {
        errors.push(`Change to ${field} is too large (${(diff * 100).toFixed(0)}%), requires human approval`);
      }
    }
  }

  // 4. Justification grounding (basic check - just ensure justifications exist)
  if (!proposedConfig.justification) {
    errors.push('Missing justification object');
  } else {
    const requiredJustifications = ['decision_style', 'position_sizing', 'exit_rule', 'aggression', 'direction_bias'];
    for (const field of requiredJustifications) {
      if (!proposedConfig.justification[field] || proposedConfig.justification[field].length < 10) {
        errors.push(`Justification for ${field} is missing or too short`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

async function logReflectionFailure(agentId, validationLayer, errorMessage, retryAttempt, llmOutput, previousConfig) {
  try {
    await supabase.from('reflection_failures').insert({
      agent_id: agentId,
      validation_layer: validationLayer,
      error_message: errorMessage,
      retry_attempt: retryAttempt,
      llm_output: llmOutput,
      previous_config: previousConfig,
    });
  } catch (error) {
    log('Failed to log reflection failure:', error.message);
  }
}

async function reflectWithRetry(currentConfig, tradeLog, performanceSummary, agentId, maxRetries = 1) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const prompt = buildPrompt(currentConfig, tradeLog, performanceSummary, lastError);
      const llmOutput = await callGroqAPI(prompt);

      // Layer 1: Schema validation
      const schemaValidation = validateSchema(llmOutput);
      if (!schemaValidation.success) {
        lastError = JSON.stringify(schemaValidation.error.format(), null, 2);
        if (attempt === maxRetries) {
          await logReflectionFailure(agentId, 'L1', lastError, attempt, llmOutput, currentConfig);
          return { success: false, error: 'Schema validation failed after retries' };
        }
        continue;
      }

      const proposedConfig = schemaValidation.data;

      // Layer 3: Business rule validation
      const businessValidation = validateBusinessRules(currentConfig, proposedConfig, performanceSummary);
      if (!businessValidation.valid) {
        await logReflectionFailure(agentId, 'L3', businessValidation.errors.join(', '), attempt, llmOutput, currentConfig);
        return { success: false, error: businessValidation.errors.join(', ') };
      }

      // All validations passed
      return { success: true, config: proposedConfig };

    } catch (error) {
      lastError = error.message;
      if (attempt === maxRetries) {
        await logReflectionFailure(agentId, 'API', lastError, attempt, null, currentConfig);
        return { success: false, error: lastError };
      }
    }
  }

  return { success: false, error: 'Unknown error in reflection' };
}

export async function reflectOnStrategy(agentId, currentConfig, tradeLog, performanceSummary) {
  log(`Starting LLM reflection for agent ${agentId}`);

  const result = await reflectWithRetry(currentConfig, tradeLog, performanceSummary, agentId);

  if (!result.success) {
    log(`LLM reflection failed for agent ${agentId}: ${result.error}`);
    return { success: false, error: result.error };
  }

  log(`LLM reflection succeeded for agent ${agentId}`);

  // Update agent with new config
  try {
    const { error } = await supabase
      .from('agents')
      .update({
        market_focus: result.config.market_focus,
        decision_style: result.config.decision_style,
        confirmation_tolerance: result.config.confirmation_tolerance,
        score_state_mode: result.config.score_state_mode,
        side_bias: result.config.side_bias,
        reaction_latency_ms: result.config.reaction_latency_ms,
        position_sizing: result.config.position_sizing,
        fixed_stake: result.config.fixed_stake,
        percentage_stake: result.config.percentage_stake,
        exit_rule: result.config.exit_rule,
        stop_loss: result.config.stop_loss,
        take_profit: result.config.take_profit,
        aggression: result.config.aggression,
        cooldown_minutes: result.config.cooldown_minutes,
        direction_bias: result.config.direction_bias,
        last_reflection_timestamp: new Date().toISOString(),
      })
      .eq('id', agentId);

    if (error) {
      log(`Failed to update agent config: ${error.message}`);
      return { success: false, error: 'Database update failed' };
    }

    return { success: true, config: result.config };
  } catch (error) {
    log(`Failed to update agent config: ${error.message}`);
    return { success: false, error: 'Database update failed' };
  }
}

export async function shouldTriggerReflection(agentId, lastReflectionTimestamp, tradeCount) {
  // Trigger reflection if:
  // 1. Agent has llm_reflection_enabled = true
  // 2. Last reflection was > 1 match ago (or never)
  // 3. Agent has completed trades (passed as tradeCount param)

  const { data: agent, error } = await supabase
    .from('agents')
    .select('llm_reflection_enabled')
    .eq('id', agentId)
    .single();

  if (error || !agent) {
    log(`Failed to fetch agent for reflection check: ${error?.message}`);
    return false;
  }

  if (!agent.llm_reflection_enabled) {
    return false;
  }

  if (tradeCount === 0) {
    return false;
  }

  // If never reflected, trigger
  if (!lastReflectionTimestamp) {
    return true;
  }

  // If last reflection was > 1 hour ago, trigger (adjust based on match duration)
  const lastReflection = new Date(lastReflectionTimestamp);
  const hoursSinceReflection = (Date.now() - lastReflection.getTime()) / (1000 * 60 * 60);
  
  return hoursSinceReflection > 1;
}
