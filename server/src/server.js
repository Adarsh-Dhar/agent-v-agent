import express from 'express';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

import { supabase } from './lib/supabaseClient.js';
import { validateAgentConfig, validateRunConfig } from './lib/validateConfig.js';
import { createFundedRunWallet, ensureMarket } from './lib/solanaClient.js';
import { resetMatchEpoch } from './lib/matchClock.js';
import fs from 'fs';

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
 *     "decision_style": "volatility_breakout",
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
 *     "phase_weighting": "full_match",
 *     "max_reentries": 5,
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
    decision_style: config?.decision_style || 'volatility_breakout',
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
    fixed_stake: config?.sizing?.fixed_stake || 0.05,
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
    phase_weighting: config?.phase_weighting || 'full_match',
    max_reentries: config?.max_reentries || 5,
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

  // Check if this is a replay match (format: replay-{fixture-id})
  const isReplayMatch = match_id?.startsWith('replay-');

  // Clean up ticks, trades, and ALL prior runs (active/error/stopped) from
  // previous replays of this same fixture. Replay match_ids are reused
  // across every "new match" that picks the demo fixture, so this MUST run
  // before the existingRun guard below -- otherwise an orphaned 'active' row
  // left behind by a crashed/killed agentRunner process gets picked up by
  // the guard and the request short-circuits with 'already_running' before
  // ever reaching this cleanup, leaving a dead run with stale balance/pnl
  // and no live process ticking.
  if (isReplayMatch) {
    // match_ticks/match_clocks are shared across every player in the match;
    // harmless to (re)clear once per player since agentRunner just
    // re-inserts/re-derives them.
    await supabase.from('match_ticks').delete().eq('match_id', match_id);
    await resetMatchEpoch(match_id).catch(() => {});
    // trades and agent_runs are per-agent -- scope the delete to THIS
    // agent_id, or one player's cleanup would wipe another player's
    // just-created run when startAgentRuns() fires one POST per player
    // concurrently for the same match_id.
    await supabase.from('trades').delete().eq('match_id', match_id).eq('agent_id', agent.id);
    await supabase.from('agent_runs').delete().eq('match_id', match_id).eq('agent_id', agent.id);
  }

  // Guard: if this agent already has an active run for this match, return it
  // instead of spawning a duplicate (prevents double-funding on reload/double-click).
  // For replay matches this only ever matches a run created earlier in THIS
  // same session, since the cleanup above just wiped out anything older.
  const { data: existingRun } = await supabase
    .from('agent_runs')
    .select('id, status')
    .eq('agent_id', agent.id)
    .eq('match_id', match_id)
    .eq('status', 'active')
    .maybeSingle();

  if (existingRun) {
    return res.status(200).json({ run_id: existingRun.id, agent_id: agent.id, status: 'already_running' });
  }
  
  // Fund a fresh devnet wallet for this run with budget_cap SOL,
  // then make sure the on-chain market for this match exists (and is
  // house-seeded) before the agent starts trading.
  let wallet;
  try {
    wallet = await createFundedRunWallet(budget_cap);
    await ensureMarket(match_id);
  } catch (err) {
    return res.status(502).json({ error: `Solana setup failed: ${err.message}` });
  }

  const { data: run, error } = await supabase
    .from('agent_runs')
    .insert({
      agent_id: agent.id,
      match_id,
      budget_cap,
      balance: budget_cap,
      status: 'active',
      wallet_pubkey: wallet.keypair.publicKey.toBase58(),
      wallet_secret_key: Array.from(wallet.keypair.secretKey),
    })
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

// ── DUMMY / DEMO ────────────────────────────────────────────────────
const DUMMY_FIXTURE = {
  fixture_id: 18241006,
  home_team: 'England',
  away_team: 'Argentina',
  sport: 'soccer',
  start_time: new Date().toISOString(),
  timeline_length: 91,
};

const SIMULATED_FIXTURE = {
  fixture_id: 99999999,
  home_team: 'Argentina',
  away_team: 'England',
  sport: 'soccer',
  start_time: new Date().toISOString(),
  timeline_length: 91,
  is_replay: true,
};

// ── FIXTURES ────────────────────────────────────────────────────────
app.get('/fixtures', async (_req, res) => {
  try {
    const { txlineRequest } = await import('./lib/txline.js');
    
    // Try to fetch live fixtures from TxLINE API
    try {
      const liveFixtures = await txlineRequest('/api/fixtures/snapshot');
      if (Array.isArray(liveFixtures) && liveFixtures.length > 0) {
        const fixtures = liveFixtures.map(f => ({
          fixture_id: f.FixtureId,
          home_team: f.Participant1,
          away_team: f.Participant2,
          sport: 'soccer',
          start_time: new Date(f.StartTime).toISOString(),
          competition: f.Competition,
          game_state: f.GameState,
          is_replay: false,
        }));
        // Always add simulated fixture
        fixtures.push(SIMULATED_FIXTURE);
        return res.json({ fixtures });
      }
    } catch (txlineError) {
      console.log('[server] TxLINE fetch failed, falling back to replay fixtures:', txlineError.message);
    }
    
    // Fallback to replay fixtures
    const replaysDir = path.join(__dirname, 'lib', 'replays');
    if (!fs.existsSync(replaysDir)) {
      return res.json({ fixtures: [DUMMY_FIXTURE, SIMULATED_FIXTURE] });
    }
    const files = fs.readdirSync(replaysDir).filter(f => f.endsWith('.json'));
    const fixtures = files.map(f => {
      const raw = JSON.parse(fs.readFileSync(path.join(replaysDir, f), 'utf8'));
      return {
        fixture_id: raw.fixture_id,
        home_team: raw.home_team,
        away_team: raw.away_team,
        sport: raw.sport || 'soccer',
        start_time: raw.start_time || null,
        timeline_length: raw.timeline?.length || 0,
        is_replay: true,
      };
    });
    if (fixtures.length === 0) fixtures.push(DUMMY_FIXTURE);
    fixtures.push(SIMULATED_FIXTURE);
    return res.json({ fixtures });
  } catch (err) {
    console.error('[server] GET /fixtures error:', err.message);
    return res.json({ fixtures: [DUMMY_FIXTURE] });
  }
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
