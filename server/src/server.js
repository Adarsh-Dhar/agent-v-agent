import express from 'express';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

import { supabase } from './lib/supabaseClient.js';
import { validateAgentConfig } from './lib/validateConfig.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = path.join(__dirname, 'agentRunner.js');

const app = express();
app.use(express.json());

/**
 * POST /agents
 * Body example:
 * {
 *   "match_id": "wc-2026-final",
 *   "owner": "alice",
 *   "budget_cap": 500,
 *   "config": {
 *     "name": "My Agent",
 *     "description": "A momentum-based trader",
 *     "signal": {
 *       "type": "odds_movement",
 *       "threshold": 5,
 *       "timeframe": 5,
 *       "secondary": null,
 *       "volatility_threshold": null,
 *       "volatility_timeframe": null,
 *       "mean_reversion_threshold": null,
 *       "momentum_threshold": null,
 *       "time_decay_start": null,
 *       "time_decay_end": null
 *     },
 *     "sizing": {
 *       "type": "percent_of_budget",
 *       "percentage": 10,
 *       "fixed_stake": null,
 *       "confidence_weighted": false
 *     },
 *     "exit": {
 *       "type": "stop_loss_take_profit",
 *       "stop_loss": 5,
 *       "take_profit": 15,
 *       "time_based_exit_time": null
 *     },
 *     "aggression": {
 *       "type": "instant",
 *       "cooldown_minutes": 2,
 *       "confirmation_threshold": 2
 *     },
 *     "direction": "bidirectional",
 *     "target_selection": "both",
 *     "phase_weighting": "uniform",
 *     "reentry_rule": "capped_reentry",
 *     "max_reentries": 5,
 *     "portfolio_behavior": "independent",
 *     "adaptivity": "static",
 *     "risk_ceiling": {
 *       "max_exposure_pct": null,
 *       "max_drawdown_stop_pct": null
 *     }
 *   }
 * }
 */
app.post('/agents', async (req, res) => {
  try {
    validateAgentConfig(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { match_id, owner, budget_cap, config } = req.body;

  // Map nested config object to individual columns
  const agentData = {
    name: config?.name || 'Unnamed Agent',
    description: config?.description || '',
    signal_type: config?.signal?.type || 'odds-movement',
    odds_threshold: config?.signal?.threshold || 5,
    odds_timeframe: config?.signal?.timeframe || 5,
    secondary_signal_type: config?.signal?.secondary?.type || null,
    secondary_signal_threshold: config?.signal?.secondary?.threshold || null,
    volatility_threshold: config?.signal?.volatility_threshold || null,
    volatility_timeframe: config?.signal?.volatility_timeframe || null,
    mean_reversion_threshold: config?.signal?.mean_reversion_threshold || null,
    momentum_threshold: config?.signal?.momentum_threshold || null,
    time_decay_start: config?.signal?.time_decay_start || null,
    time_decay_end: config?.signal?.time_decay_end || null,
    position_sizing: config?.sizing?.type || 'fixed',
    fixed_stake: config?.sizing?.fixed_stake || 100,
    percentage_stake: config?.sizing?.percentage || 10,
    confidence_weighted: config?.sizing?.confidence_weighted || false,
    exit_rule: config?.exit?.type || 'stop-loss',
    stop_loss: config?.exit?.stop_loss || 5,
    take_profit: config?.exit?.take_profit || 15,
    time_based_exit_time: config?.exit?.time_based_exit_time || null,
    aggression: config?.aggression?.type || 'instant',
    cooldown_minutes: config?.aggression?.cooldown_minutes || 2,
    confirmation_threshold: config?.aggression?.confirmation_threshold || 2,
    direction_bias: config?.direction || 'bidirectional',
    target_selection: config?.target_selection || 'both',
    phase_weighting: config?.phase_weighting || 'uniform',
    reentry_rule: config?.reentry_rule || 'capped_reentry',
    max_reentries: config?.max_reentries || 5,
    portfolio_behavior: config?.portfolio_behavior || 'independent',
    adaptivity_mode: config?.adaptivity || 'static',
    llm_reflection_enabled: config?.adaptivity === 'llm_reflective',
    max_exposure_pct: config?.risk_ceiling?.max_exposure_pct || null,
    max_drawdown_stop_pct: config?.risk_ceiling?.max_drawdown_stop_pct || null,
    match_id: match_id || null,
    owner: owner || null,
    budget_cap: budget_cap || 5000,
    balance: budget_cap || 5000,
    status: 'active',
  };

  // 1. Insert the agent row in Supabase first, so we have an agent_id.
  const { data: agent, error } = await supabase
    .from('agents')
    .insert(agentData)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: `Supabase insert failed: ${error.message}` });
  }

  // 2. Spawn the agent runner as its own child process, passing agent_id.
  //    'inherit' pipes the child's stdout/stderr straight to this server's
  //    terminal, so you see each agent's decisions live as it runs.
  const child = spawn('node', [RUNNER_PATH, agent.id], {
    stdio: 'inherit',
    detached: false,
  });

  child.on('exit', (code) => {
    console.log(`[server] agent ${agent.id} process exited with code ${code}`);
  });

  child.on('error', (err) => {
    console.error(`[server] failed to spawn agent ${agent.id}:`, err.message);
  });

  // 3. Respond immediately with the agent_id; the agent keeps running
  //    in the background and updates itself in Supabase.
  return res.status(201).json({
    agent_id: agent.id,
    status: 'created',
    pid: child.pid,
    message: 'Agent created and started. Watch this server terminal for live logs.',
  });
});

/** GET /agents/:id - fetch current state (balance, PnL, status) */
app.get('/agents/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Agent not found' });
  return res.json(data);
});

/** POST /agents/:id/stop - flips status to 'stopped'; the runner polls this and exits */
app.post('/agents/:id/stop', async (req, res) => {
  const { error } = await supabase
    .from('agents')
    .update({ status: 'stopped' })
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ status: 'stopping' });
});

/** GET /matches/:matchId/leaderboard - agents ranked by total PnL for a match */
app.get('/matches/:matchId/leaderboard', async (req, res) => {
  const { data, error } = await supabase
    .from('agents')
    .select('id, owner, balance, realized_pnl, unrealized_pnl, trade_count, status')
    .eq('match_id', req.params.matchId)
    .order('balance', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Agent Arena server listening on port ${PORT}`);
});
