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
 *     "signal": { "type": "odds_movement", "threshold": 0.02, "secondary": null },
 *     "sizing": { "type": "percent_of_budget", "percent": 0.1 },
 *     "exit": { "type": "signal_reversal" },
 *     "aggression": { "type": "instant" },
 *     "direction": "bidirectional"
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
    position_sizing: config?.sizing?.type || 'fixed',
    fixed_stake: config?.sizing?.fixed_stake || 100,
    percentage_stake: config?.sizing?.percentage || 10,
    exit_rule: config?.exit?.type || 'stop-loss',
    stop_loss: config?.exit?.stop_loss || 5,
    take_profit: config?.exit?.take_profit || 15,
    aggression: config?.aggression?.type || 'instant',
    cooldown_minutes: config?.aggression?.cooldown || 2,
    direction_bias: config?.direction || 'bidirectional',
    adaptivity_mode: config?.adaptivity || 'static',
    llm_reflection_enabled: config?.adaptivity === 'llm_reflective',
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
