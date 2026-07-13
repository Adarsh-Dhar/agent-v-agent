#!/usr/bin/env node
/**
 * Creates a random agent with randomized strategy parameters and runs it.
 * Usage: node scripts/createRandomAgent.js <match_id> [--budget <amount>]
 * Example: node scripts/createRandomAgent.js wc-2026-final --budget 10000
 */

import { supabase } from '../src/lib/supabaseClient.js';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = path.join(__dirname, '../src/agentRunner.js');

// Factor choices based on the strategy design doc
const FACTORS = {
  signal: [
    'odds-movement',
    'score_state',
    'mean_reversion',
    'momentum',
    'time_decay',
    'volatility_spike'
  ],
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
    'uniform',
    'front_loaded',
    'back_loaded',
    'event_triggered'
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

  const signal = randomChoice(FACTORS.signal);
  console.log(`📡 Signal Type: ${signal}`);

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
  console.log(`⏱️  Match-Phase Weighting: ${phaseWeighting}`);

  // I. Re-entry Rule: cap the number of trades this agent can open per match.
  const maxReentries = randomInt(1, 5);
  console.log(`♻️  Max Re-entries: ${maxReentries}`);

  // L. Risk Ceiling: cap any single stake, and halt entirely past a drawdown limit.
  const maxExposurePct = randomInt(20, 50);
  const maxDrawdownStopPct = randomInt(15, 40);
  console.log(`🛑 Max Exposure: ${maxExposurePct}% of balance per trade`);
  console.log(`🛑 Max Drawdown Stop: ${maxDrawdownStopPct}%`);

  const config = {
    signal_type: signal,
    position_sizing: sizing,
    exit_rule: exit,
    aggression: aggression,
    direction_bias: direction,
    adaptivity_mode: adaptivity,
    phase_weighting: phaseWeighting,
    max_reentries: maxReentries,
    max_exposure_pct: maxExposurePct,
    max_drawdown_stop_pct: maxDrawdownStopPct,
  };

  // Add signal-specific parameters
  if (signal === 'odds-movement' || signal === 'odds_movement') {
    config.odds_threshold = randomInt(2, 10);
    config.odds_timeframe = randomInt(2, 10);
    console.log(`   └─ Odds Threshold: ${config.odds_threshold}%`);
    console.log(`   └─ Odds Timeframe: ${config.odds_timeframe} minutes`);
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

  console.log();
  return config;
}

async function createAndRunAgent(matchId, budgetCap) {
  console.log(`Creating random agent for match: ${matchId}`);
  console.log(`Budget cap: ${budgetCap}`);

  const config = generateRandomConfig();
  
  console.log('\nGenerated configuration:');
  console.log(JSON.stringify(config, null, 2));

  const agentData = {
    name: `Random Agent ${Date.now()}`,
    description: 'Auto-generated random strategy agent',
    match_id: matchId,
    owner: 'random_generator',
    budget_cap: budgetCap,
    balance: budgetCap,
    status: 'active',
    ...config
  };

  // Insert agent into database
  const { data: agent, error } = await supabase
    .from('agents')
    .insert(agentData)
    .select()
    .single();

  if (error) {
    console.error('Failed to create agent:', error.message);
    process.exit(1);
  }

  console.log(`\n✓ Agent created with ID: ${agent.id}`);

  // Spawn the agent runner
  const child = spawn('node', [RUNNER_PATH, agent.id], {
    stdio: 'inherit',
    detached: false,
  });

  console.log(`✓ Agent runner started with PID: ${child.pid}`);
  console.log('\nAgent is now running. Watch terminal for live trading logs.');

  child.on('exit', (code) => {
    console.log(`\nAgent process exited with code ${code}`);
  });

  child.on('error', (err) => {
    console.error(`Failed to spawn agent:`, err.message);
  });

  // Keep the process running
  process.on('SIGINT', () => {
    console.log('\nStopping agent...');
    child.kill('SIGINT');
    process.exit(0);
  });
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
