// This file is spawned as its own child process per agent, so each agent's
// activity shows up as its own running process with its own terminal output.
//
// Usage: node src/agentRunner.js <agent_id>

import { supabase } from './lib/supabaseClient.js';
import { fetchOddsSnapshot } from './lib/txline.js';
import { evaluateSignal, computeStake } from './lib/strategyEngine.js';

const agentId = process.argv[2];
if (!agentId) {
  console.error('Usage: node agentRunner.js <agent_id>');
  process.exit(1);
}

const POLL_INTERVAL_MS = 5000;
const history = [];
let position = null; // { side, odds, stake } while a position is open

function log(...args) {
  console.log(`[agent ${agentId}]`, ...args);
}

async function loadAgent() {
  const { data, error } = await supabase.from('agents').select('*').eq('id', agentId).single();
  if (error) throw new Error(`Failed to load agent ${agentId}: ${error.message}`);
  return data;
}

async function updateAgent(fields) {
  const { error } = await supabase
    .from('agents')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', agentId);
  if (error) log('WARN: failed to update agent row:', error.message);
}

async function recordTrade(agent, side, odds, stake, reason) {
  const { error } = await supabase.from('trades').insert({
    agent_id: agentId,
    match_id: agent.match_id,
    side,
    odds,
    stake,
    reason,
  });
  if (error) log('WARN: failed to record trade:', error.message);
}

// Simple mark-to-market PnL: buying means betting the odds will shorten
// (price of the outcome goes up in probability terms); we approximate PnL
// as stake * (odds_at_entry / odds_now - 1) for a 'buy', inverse for 'sell'.
function markToMarket(entryOdds, currentOdds, side, stake) {
  const change =
    side === 'buy' ? (entryOdds - currentOdds) / entryOdds : (currentOdds - entryOdds) / entryOdds;
  return stake * change;
}

async function tick(agent) {
  const snapshot = await fetchOddsSnapshot(agent.match_id);
  history.push(snapshot);
  if (history.length > 50) history.shift(); // keep a bounded rolling window

  log(`odds=${snapshot.odds} minute=${snapshot.minute} event=${snapshot.event ?? '-'}`);

  // Update unrealized PnL if a position is open
  if (position) {
    const unrealized = markToMarket(position.odds, snapshot.odds, position.side, position.stake);
    await updateAgent({ unrealized_pnl: unrealized });
  }

  const decision = evaluateSignal(agent, history);

  if (decision.action === 'hold') return;

  // Exit an open position on signal-reversal exit rule
  if (position && agent.exit_rule === 'signal_reversal' && decision.action !== position.side) {
    const realized = markToMarket(position.odds, snapshot.odds, position.side, position.stake);
    const newBalance = agent.balance + realized;
    const newRealizedTotal = (agent.realized_pnl ?? 0) + realized;
    log(`CLOSE ${position.side} stake=${position.stake} pnl=${realized.toFixed(2)} -> balance=${newBalance.toFixed(2)}`);
    await recordTrade(agent, `close_${position.side}`, snapshot.odds, position.stake, decision.reason);
    await updateAgent({
      balance: newBalance,
      realized_pnl: newRealizedTotal,
      unrealized_pnl: 0,
    });
    agent.balance = newBalance;
    agent.realized_pnl = newRealizedTotal;
    position = null;
  }

  // Open a new position if none is open (one position at a time, kept simple)
  if (!position) {
    const stake = computeStake(agent, agent.balance, decision.confidence);
    if (stake <= 0 || stake > agent.balance) return;

    position = { side: decision.action, odds: snapshot.odds, stake };
    const newTradeCount = (agent.trade_count ?? 0) + 1;

    log(`OPEN ${decision.action} stake=${stake.toFixed(2)} @odds=${snapshot.odds} reason=${decision.reason}`);
    await recordTrade(agent, decision.action, snapshot.odds, stake, decision.reason);
    await updateAgent({ trade_count: newTradeCount, status: 'running' });
    agent.trade_count = newTradeCount;
  }
}

async function main() {
  log('starting up...');
  let agent = await loadAgent();
  log(`loaded config: signal=${agent.signal_type} sizing=${agent.position_sizing} match=${agent.match_id} budget=${agent.budget_cap}`);

  await updateAgent({ status: 'running', pid: process.pid });

  const interval = setInterval(async () => {
    try {
      agent = await loadAgent(); // refresh in case budget/status changed externally
      if (agent.status === 'stopped' || agent.status === 'inactive') {
        log('status=stopped, shutting down.');
        clearInterval(interval);
        process.exit(0);
      }
      await tick(agent);
    } catch (err) {
      log('ERROR during tick:', err.message);
      await updateAgent({ status: 'error' });
    }
  }, POLL_INTERVAL_MS);

  process.on('SIGINT', async () => {
    log('received SIGINT, marking stopped.');
    await updateAgent({ status: 'stopped' });
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`[agent ${agentId}] FATAL:`, err);
  process.exit(1);
});
