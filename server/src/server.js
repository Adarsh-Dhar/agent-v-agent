import express from 'express';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

import { supabase } from './lib/supabaseClient.js';
import { validateAgentConfig, validateRunConfig } from './lib/validateConfig.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = path.join(__dirname, 'agentRunner.js');

const app = express();
app.use(express.json());

/**
 * POST /agents
 * Body example (strategy config only, no match/balance):
 * {
 *   "owner": "alice",
 *   "config": {
 *     "name": "My Agent",
 *     "description": "A momentum-based trader",
 *     "market_focus": "1x2",
 *     "ah_line_band": null,
 *     "ou_line_band": null,
 *     "decision_style": "balanced",
 *     "confirmation_tolerance": "adaptive",
 *     "score_state_mode": "momentum_only",
 *     "side_bias": "none",
 *     "risk_profile": "flat_stake",
 *     "reaction_latency_ms": 3000,
 *     "context_venue_aware": false,
 *     "context_weather_aware": false,
 *     "context_competition_tier_aware": false,
 *     "wildcard_trait": "none",
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
 *     "phase_weighting": "full_match",
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

  const { owner, config } = req.body;

  // Map nested config object to individual columns
  const agentData = {
    name: config?.name || 'Unnamed Agent',
    description: config?.description || '',
    market_focus: config?.market_focus || '1x2',
    ah_line_band: config?.ah_line_band || null,
    ou_line_band: config?.ou_line_band || null,
    decision_style: config?.decision_style || 'balanced',
    odds_lookback_ticks: config?.odds_lookback_ticks ?? 3,
    odds_threshold_pct: config?.odds_threshold_pct ?? 2,
    volatility_window: config?.volatility_window ?? 6,
    breakout_zscore: config?.breakout_zscore ?? 1.5,
    confirmation_tolerance: config?.confirmation_tolerance || 'adaptive',
    score_state_mode: config?.score_state_mode || 'momentum_only',
    side_bias: config?.side_bias || 'none',
    risk_profile: config?.risk_profile || 'flat_stake',
    reaction_latency_ms: config?.reaction_latency_ms ?? 3000,
    context_venue_aware: config?.context_venue_aware ?? false,
    context_weather_aware: config?.context_weather_aware ?? false,
    context_competition_tier_aware: config?.context_competition_tier_aware ?? false,
    wildcard_trait: config?.wildcard_trait || 'none',
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
    phase_weighting: config?.phase_weighting || 'full_match',
    reentry_rule: config?.reentry_rule || 'capped_reentry',
    max_reentries: config?.max_reentries || 5,
    portfolio_behavior: config?.portfolio_behavior || 'independent',
    adaptivity_mode: config?.adaptivity || 'static',
    llm_reflection_enabled: config?.adaptivity === 'llm_reflective',
    max_exposure_pct: config?.risk_ceiling?.max_exposure_pct || null,
    max_drawdown_stop_pct: config?.risk_ceiling?.max_drawdown_stop_pct || null,
    owner: owner || null,
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

  return res.status(201).json({
    agent_id: agent.id,
    status: 'created',
    message: 'Agent created. Use POST /agents/:id/run to start a session.',
  });
});

/** GET /agents/:id - fetch strategy config only (no balance/PnL) */
app.get('/agents/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Agent not found' });
  return res.json(data);
});

/** POST /agents/:id/run - start a new session with specific match and balance */
app.post('/agents/:id/run', async (req, res) => {
  try {
    validateRunConfig(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const { match_id, budget_cap } = req.body;

  const { data: agent, error: agentErr } = await supabase
    .from('agents').select('id').eq('id', req.params.id).single();
  if (agentErr) return res.status(404).json({ error: 'Agent not found' });

  const { data: run, error } = await supabase
    .from('agent_runs')
    .insert({ agent_id: agent.id, match_id, budget_cap, balance: budget_cap, status: 'active' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  const child = spawn('node', [RUNNER_PATH, run.id], { stdio: 'inherit', detached: false });
  child.on('exit', (code) => console.log(`[server] run ${run.id} exited code ${code}`));

  return res.status(201).json({ run_id: run.id, agent_id: agent.id, status: 'created', pid: child.pid });
});

/** GET /runs/:id - fetch run state (balance, PnL, status) */
app.get('/runs/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Run not found' });
  return res.json(data);
});

/** POST /runs/:id/stop - flips status to 'stopped'; the runner polls this and exits */
app.post('/runs/:id/stop', async (req, res) => {
  const { error } = await supabase
    .from('agent_runs')
    .update({ status: 'stopped' })
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ status: 'stopping' });
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

/** GET /matches/:matchId/leaderboard - runs ranked by total PnL for a match */
app.get('/matches/:matchId/leaderboard', async (req, res) => {
  const { data, error } = await supabase
    .from('agent_runs')
    .select('id, agent_id, match_id, balance, realized_pnl, unrealized_pnl, trade_count, status, agents(name, owner)')
    .eq('match_id', req.params.matchId)
    .order('balance', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Agent Arena server listening on port ${PORT}`);
});
