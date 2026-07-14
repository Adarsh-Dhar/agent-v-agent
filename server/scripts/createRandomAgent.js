#!/usr/bin/env node
/**
 * Creates a random agent with randomized strategy parameters and runs it.
 * Usage: node scripts/createRandomAgent.js <match_id> [--budget <amount>]
 * Example: node scripts/createRandomAgent.js wc-2026-final --budget 10000
 */

import axios from 'axios';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

// Factor choices based on the 10-factor config
const FACTORS = {
  market_focus: ['1x2', 'asian_handicap', 'over_under', 'multi_market'],
  decision_style: ['anticipatory', 'confirmatory', 'balanced'],
  confirmation_tolerance: ['aggressive', 'conservative', 'adaptive'],
  score_state_mode: ['favor_chasing', 'favor_leading', 'momentum_only'],
  side_bias: ['home', 'away', 'favorite', 'underdog', 'none'],
  risk_profile: ['conservative', 'aggressive', 'martingale', 'flat_stake'],
  position_sizing: [
    'fixed',
    'percent_of_budget',
    'confidence_weighted'
  ],
  exit_rule: [
    'stop-loss',
    'time_based',
    'signal_reversal'
  ],
  aggression: [
    'instant',
    'confirmation',
    'cooldown'
  ],
  direction_bias: [
    'long_only',
    'short_only',
    'bidirectional'
  ],
  adaptivity_mode: [
    'static',
    'self_adjusting',
    'llm_reflective'
  ],
  phase_weighting: [
    'early',
    'pre_halftime',
    'second_half',
    'late_stoppage',
    'full_match'
  ],
  reentry_rule: [
    'no_reentry',
    'immediate_reentry',
    'capped_reentry'
  ],
  wildcard_trait: [
    'none',
    'chaos_agent',
    'comeback_romantic',
    'revenge_trader',
    'superstition',
    'weather_prophet',
    'rivalry_rage',
    'bandwagon',
    'contrarian',
    'last_minute_believer',
    'nostalgia_trader'
  ]
};

function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRandomConfig() {
  console.log('\n🎲 Randomizing strategy factors...\n');

  const marketFocus = randomChoice(FACTORS.market_focus);
  console.log(`🎯 Market Focus: ${marketFocus}`);

  const decisionStyle = randomChoice(FACTORS.decision_style);
  console.log(`🧠 Decision Style: ${decisionStyle}`);

  const confirmationTolerance = randomChoice(FACTORS.confirmation_tolerance);
  console.log(`✅ Confirmation Tolerance: ${confirmationTolerance}`);

  const scoreStateMode = randomChoice(FACTORS.score_state_mode);
  console.log(`� Score-State Mode: ${scoreStateMode}`);

  const sideBias = randomChoice(FACTORS.side_bias);
  console.log(`⚖️  Side Bias: ${sideBias}`);

  const riskProfile = randomChoice(FACTORS.risk_profile);
  console.log(`💎 Risk Profile: ${riskProfile}`);

  const sizing = randomChoice(FACTORS.position_sizing);
  console.log(`💰 Position Sizing: ${sizing}`);

  const exit = randomChoice(FACTORS.exit_rule);
  console.log(`🚪 Exit Rule: ${exit}`);

  const aggression = randomChoice(FACTORS.aggression);
  console.log(`⚡ Aggression: ${aggression}`);

  const direction = randomChoice(FACTORS.direction_bias);
  console.log(`🧭 Direction Bias: ${direction}`);

  const adaptivity = randomChoice(FACTORS.adaptivity_mode);
  console.log(`🔄 Adaptivity Mode: ${adaptivity}`);

  const phaseWeighting = randomChoice(FACTORS.phase_weighting);
  const reentryRule = randomChoice(FACTORS.reentry_rule);
  // Derive the numeric cap the runner actually enforces from the chosen rule.
  const maxReentries =
    reentryRule === 'no_reentry' ? 1 :
    reentryRule === 'immediate_reentry' ? null :
    randomInt(2, 10); // capped_reentry
  console.log(`⏱️  Match-Phase Weighting: ${phaseWeighting}`);
  console.log(`♻️  Re-entry Rule: ${reentryRule} (max_reentries: ${maxReentries ?? 'unlimited'})`);

  const reactionLatency = randomInt(0, 30000);
  console.log(`⏱️  Reaction Latency: ${reactionLatency}ms`);

  const wildcardTrait = randomChoice(FACTORS.wildcard_trait);
  console.log(`🎲 Wildcard Trait: ${wildcardTrait}`);

  // L. Risk Ceiling: cap any single stake, and halt entirely past a drawdown limit.
  const maxExposurePct = randomInt(20, 50);
  const maxDrawdownStopPct = randomInt(15, 40);
  console.log(`🛑 Max Exposure: ${maxExposurePct}% of balance per trade`);
  console.log(`🛑 Max Drawdown Stop: ${maxDrawdownStopPct}%`);

  const config = {
    market_focus: marketFocus,
    decision_style: decisionStyle,
    confirmation_tolerance: confirmationTolerance,
    score_state_mode: scoreStateMode,
    side_bias: sideBias,
    risk_profile: riskProfile,
    position_sizing: sizing,
    exit_rule: exit,
    aggression: aggression,
    direction_bias: direction,
    adaptivity_mode: adaptivity,
    phase_weighting: phaseWeighting,
    reentry_rule: reentryRule,
    max_reentries: maxReentries,
    reaction_latency_ms: reactionLatency,
    wildcard_trait: wildcardTrait,
    max_exposure_pct: maxExposurePct,
    max_drawdown_stop_pct: maxDrawdownStopPct,
  };

  // Add market-specific parameters
  if (marketFocus === 'asian_handicap') {
    config.ah_line_band = randomChoice(['tight', 'deep']);
    console.log(`   └─ AH Line Band: ${config.ah_line_band}`);
  }
  if (marketFocus === 'over_under') {
    config.ou_line_band = randomChoice(['low', 'mid', 'high']);
    console.log(`   └─ OU Line Band: ${config.ou_line_band}`);
  }

  // Add sizing-specific parameters
  if (sizing === 'fixed') {
    config.fixed_stake = randomInt(50, 200);
    console.log(`   └─ Fixed Stake: $${config.fixed_stake}`);
  } else if (sizing === 'percent_of_budget' || sizing === 'percentage') {
    config.percentage_stake = randomInt(5, 20);
    console.log(`   └─ Percentage Stake: ${config.percentage_stake}%`);
  }

  // Add exit-specific parameters
  if (exit === 'stop-loss' || exit === 'stop_loss_take_profit') {
    config.stop_loss = randomInt(3, 10);
    config.take_profit = randomInt(10, 25);
    console.log(`   └─ Stop Loss: ${config.stop_loss}%`);
    console.log(`   └─ Take Profit: ${config.take_profit}%`);
  }

  // Add aggression-specific parameters
  if (aggression === 'cooldown') {
    config.cooldown_minutes = randomInt(1, 5);
    console.log(`   └─ Cooldown: ${config.cooldown_minutes} minutes`);
  }
  if (aggression === 'confirmation') {
    config.confirmation_threshold = randomInt(2, 3);
    console.log(`   └─ Confirmation Threshold: ${config.confirmation_threshold}`);
  }

  console.log();
  return config;
}

async function createAndRunAgent(matchId, budgetCap) {
  console.log(`Creating random agent for match: ${matchId}`);
  console.log(`Budget cap: ${budgetCap}`);

  const config = generateRandomConfig();
  
  console.log('\nGenerated configuration:');
  console.log(JSON.stringify(config, null, 2));

  // Step 1: Create agent with strategy config only
  const agentData = {
    owner: 'random_generator',
    config: {
      name: `Random Agent ${Date.now()}`,
      description: 'Auto-generated random strategy agent',
      market_focus: config.market_focus,
      ah_line_band: config.ah_line_band || null,
      ou_line_band: config.ou_line_band || null,
      decision_style: config.decision_style,
      confirmation_tolerance: config.confirmation_tolerance,
      score_state_mode: config.score_state_mode,
      side_bias: config.side_bias,
      risk_profile: config.risk_profile,
      reaction_latency_ms: config.reaction_latency_ms,
      context_venue_aware: false,
      context_weather_aware: false,
      context_competition_tier_aware: false,
      wildcard_trait: config.wildcard_trait,
      sizing: {
        type: config.position_sizing,
        percentage: config.percentage_stake,
        fixed_stake: config.fixed_stake,
        confidence_weighted: config.confidence_weighted || false
      },
      exit: {
        type: config.exit_rule,
        stop_loss: config.stop_loss,
        take_profit: config.take_profit,
        time_based_exit_time: config.time_based_exit_time || null
      },
      aggression: {
        type: config.aggression,
        cooldown_minutes: config.cooldown_minutes,
        confirmation_threshold: config.confirmation_threshold || 2
      },
      direction: config.direction_bias,
      target_selection: config.target_selection || 'both',
      phase_weighting: config.phase_weighting,
      reentry_rule: config.reentry_rule,
      max_reentries: config.max_reentries,
      portfolio_behavior: config.portfolio_behavior || 'independent',
      adaptivity: config.adaptivity_mode,
      risk_ceiling: {
        max_exposure_pct: config.max_exposure_pct,
        max_drawdown_stop_pct: config.max_drawdown_stop_pct
      }
    }
  };

  try {
    const agentResponse = await axios.post(`${SERVER_URL}/agents`, agentData);
    const agentId = agentResponse.data.agent_id;
    console.log(`\n✓ Agent created with ID: ${agentId}`);

    // Step 2: Run the agent with match_id and budget_cap
    const runResponse = await axios.post(`${SERVER_URL}/agents/${agentId}/run`, {
      match_id: matchId,
      budget_cap: budgetCap
    });

    console.log(`✓ Agent run started with ID: ${runResponse.data.run_id}`);
    console.log(`✓ PID: ${runResponse.data.pid}`);
    console.log('\nAgent is now running. Watch server terminal for live trading logs.');

  } catch (error) {
    console.error('\n❌ Failed to create/run agent:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Error:', error.response.data);
    } else {
      console.error('Message:', error.message);
    }
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
let matchId = 'mock-arg-vs-sui-2026'; // default mock match
let budgetCap = 1000; // default

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--budget' && args[i + 1]) {
    budgetCap = parseInt(args[i + 1]);
    i++;
  } else if (!args[i].startsWith('--')) {
    matchId = args[i];
  }
}

createAndRunAgent(matchId, budgetCap).catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
