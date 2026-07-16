#!/usr/bin/env node
/**
 * scripts/parameterSweep.js
 *
 * Runs a parameter sweep across multiple agent configurations against the same match replay.
 * Varies stop_loss, take_profit, aggression, and other key parameters to test sensitivity.
 *
 * Usage:
 *   node scripts/parameterSweep.js --fixture 18241006
 *   node scripts/parameterSweep.js --fixture 18241006 --base-config scripts/my-agent.json
 *   node scripts/parameterSweep.js --fixture 18241006 --variations stop_loss,take_profit
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// CLI args
const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : def;
}

const FIXTURE_ID = argVal('fixture', '18241006');
const BASE_CONFIG = argVal('base-config', null);
const VARIATIONS = argVal('variations', 'stop_loss,take_profit,aggression').split(',');
const QUIET = args.includes('--quiet');

// Default base config (matches the "Build Custom" form defaults)
const DEFAULT_BASE_CONFIG = {
  name: 'base-agent',
  budget_cap: 1000,
  market_focus: '1x2',
  decision_style: 'volatility_breakout',
  confirmation_tolerance: 'adaptive',
  score_state_mode: 'momentum_only',
  side_bias: 'none',
  risk_profile: 'flat_stake',
  wildcard_trait: 'none',
  position_sizing: 'fixed',
  fixed_stake: 100,
  percentage_stake: 10,
  exit_rule: 'stop_loss_take_profit',
  stop_loss: 5,
  take_profit: 15,
  aggression: 'instant',
  cooldown_minutes: 2,
  confirmation_threshold: 2,
  direction_bias: 'bidirectional',
  target_selection: 'both',
  phase_weighting: 'full_match',
  reaction_latency_ms: 3000,
  reentry_rule: 'capped_reentry',
  max_reentries: 5,
  portfolio_behavior: 'independent',
  adaptivity_mode: 'static',
  context_venue_aware: false,
  context_weather_aware: false,
  context_competition_tier_aware: false,
  max_exposure_pct: 100,
  max_drawdown_stop_pct: 100,
  volatility_window: 6,
  breakout_zscore: 1.5,
};

// Parameter variation grids
const VARIATION_GRIDS = {
  stop_loss: [3, 5, 8, 10],
  take_profit: [10, 15, 20, 25],
  aggression: ['instant', 'cooldown', 'confirmation'],
  reaction_latency_ms: [0, 1000, 3000, 5000],
  position_sizing: ['fixed', 'percentage', 'confidence_weighted'],
  volatility_window: [4, 6, 8, 10],
  breakout_zscore: [1.2, 1.5, 2.0, 2.5],
};

// Load base config
let baseConfig = DEFAULT_BASE_CONFIG;
if (BASE_CONFIG && fs.existsSync(BASE_CONFIG)) {
  baseConfig = JSON.parse(fs.readFileSync(BASE_CONFIG, 'utf-8'));
}

// Generate all variant configurations
function generateVariants() {
  const variants = [];
  
  // Start with base config
  variants.push({ ...baseConfig, name: 'base' });
  
  // Generate variations for each requested parameter
  for (const param of VARIATIONS) {
    if (!VARIATION_GRIDS[param]) {
      console.warn(`Unknown variation parameter: ${param}`);
      continue;
    }
    
    for (const value of VARIATION_GRIDS[param]) {
      const variant = { ...baseConfig };
      variant.name = `${param}=${value}`;
      variant[param] = value;
      variants.push(variant);
    }
  }
  
  return variants;
}

const variants = generateVariants();
console.log(`Generated ${variants.length} configuration variants`);
console.log(`Parameters varying: ${VARIATIONS.join(', ')}`);
console.log(`Fixture: ${FIXTURE_ID}`);
console.log('='.repeat(78));

// Run replay for each variant
const results = [];
const tempDir = path.join(ROOT, 'scripts', '.temp-sweep');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

async function runSweep() {
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    const configPath = path.join(tempDir, `config-${i}.json`);
    
    fs.writeFileSync(configPath, JSON.stringify(variant, null, 2));
    
    if (!QUIET) {
      console.log(`\n[${i + 1}/${variants.length}] Running: ${variant.name}`);
      console.log(`  Config: ${JSON.stringify(variant, Object.keys(variant).filter(k => VARIATIONS.includes(k)))}`);
    }
    
    const result = await runReplay(configPath, FIXTURE_ID);
    results.push({ name: variant.name, config: variant, ...result });
  }

  // Clean up temp files
  fs.rmSync(tempDir, { recursive: true, force: true });

  // Analyze and display results
  console.log('\n' + '='.repeat(78));
  console.log('PARAMETER SWEEP RESULTS');
  console.log('='.repeat(78));

  // Build comparison table
  const tableData = results.map((r) => {
    const config = r.config;
    const varyingParams = {};
    for (const param of VARIATIONS) {
      if (VARIATION_GRIDS[param]) {
        varyingParams[param] = config[param];
      }
    }
    
    return {
      name: r.name,
      ...varyingParams,
      trades: r.trades,
      finalBalance: r.finalBalance,
      roi: r.roi,
      winRate: r.winRate,
    };
  });

  console.table(tableData);

  // Find best performer
  const sortedByRoi = [...results].sort((a, b) => parseFloat(b.roi) - parseFloat(a.roi));
  const best = sortedByRoi[0];
  const worst = sortedByRoi[sortedByRoi.length - 1];

  console.log(`\n🏆 Best performer: ${best.name} (${best.roi}, ${best.trades} trades)`);
  console.log(`📉 Worst performer: ${worst.name} (${worst.roi}, ${worst.trades} trades)`);

  // Sensitivity analysis
  console.log('\n' + '='.repeat(78));
  console.log('SENSITIVITY ANALYSIS');
  console.log('='.repeat(78));

  for (const param of VARIATIONS) {
    if (!VARIATION_GRIDS[param]) continue;
    
    const paramResults = results.filter((r) => r.name.includes(`${param}=`) || r.name === 'base');
    if (paramResults.length < 2) continue;
    
    console.log(`\nParameter: ${param}`);
    const sorted = paramResults.sort((a, b) => parseFloat(b.roi) - parseFloat(a.roi));
    sorted.forEach((r) => {
      const value = r.config[param];
      console.log(`  ${value}: ${r.roi} (${r.trades} trades)`);
    });
  }

  process.exit(0);
}

runSweep();

function runReplay(configPath, fixtureId) {
  return new Promise((resolve) => {
    const args = [
      'scripts/liveReplayMatch.js',
      '--fixture', fixtureId,
      '--config', configPath,
      '--fast',
      '--quiet',
    ];
    
    const proc = spawn('node', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });
    
    proc.on('close', (code) => {
      // Parse output to extract results
      const result = parseOutput(stdout);
      resolve(result);
    });
  });
}

function parseOutput(output) {
  const lines = output.split('\n');
  
  let trades = 0;
  let finalBalance = 0;
  let roi = '0%';
  let winRate = 'n/a';
  
  // Look for the "Best performer" line which contains the summary
  for (const line of lines) {
    if (line.includes('Best performer:')) {
      // Format: "Best performer: agent-name (+855.18%, 1 trades)"
      const roiMatch = line.match(/\(([+-]?\d+\.?\d*)%/);
      const tradesMatch = line.match(/(\d+)\s+trades/);
      if (roiMatch) roi = roiMatch[1] + '%';
      if (tradesMatch) trades = parseInt(tradesMatch[1]);
    }
    
    // Also look for individual trade lines
    if (line.includes('OPEN') || line.includes('CLOSE')) {
      trades = Math.max(trades, 1);
    }
  }
  
  // If we found ROI, calculate final balance assuming 1000 budget
  if (roi !== '0%') {
    const roiValue = parseFloat(roi) / 100;
    finalBalance = 1000 * (1 + roiValue);
  }
  
  return { trades, finalBalance, roi, winRate };
}
