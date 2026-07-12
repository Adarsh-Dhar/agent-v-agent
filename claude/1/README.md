# Agent Arena — TxLINE World Cup Trading Agents

Create a trading agent from a strategy config via HTTP, and it runs live as
its own Node.js child process, logging decisions to the server's terminal
and persisting state/trades to Supabase.

## 1. Setup

```bash
cd agent-arena
npm install
cp .env.example .env
# fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TXLINE_API_URL, TXLINE_API_KEY
```

Run `sql/schema.sql` in your Supabase project's SQL editor to create the
`agents` and `trades` tables.

> If you don't set `TXLINE_API_URL`/`TXLINE_API_KEY`, `src/lib/txline.js`
> falls back to a mock random-walk odds feed, so you can test the whole
> pipeline before wiring real credentials.

## 2. Run the server

```bash
npm start
```

This starts the Express server. Every agent you create will run as a
**separate child process**, and its stdout is piped straight into this
terminal (via `stdio: 'inherit'`), so you'll see logs like:

```
[agent 3f2c1a4e-...] odds=1.87 minute=42 event=goal
[agent 3f2c1a4e-...] OPEN buy stake=25.00 @odds=1.87 reason=score_state:goal
```

## 3. Create an agent

```bash
curl -X POST http://localhost:3000/agents \
  -H "Content-Type: application/json" \
  -d '{
    "match_id": "wc-2026-final",
    "owner": "alice",
    "budget_cap": 500,
    "config": {
      "signal": { "type": "odds_movement", "threshold": 0.02 },
      "sizing": { "type": "percent_of_budget", "percent": 0.1 },
      "exit": { "type": "signal_reversal" },
      "aggression": { "type": "instant" },
      "direction": "bidirectional"
    }
  }'
```

Response:

```json
{
  "agent_id": "3f2c1a4e-...",
  "status": "created",
  "pid": 48213,
  "message": "Agent created and started. Watch this server terminal for live logs."
}
```

## 4. Check status / leaderboard

```bash
curl http://localhost:3000/agents/<agent_id>
curl http://localhost:3000/matches/wc-2026-final/leaderboard
```

## 5. Stop an agent

```bash
curl -X POST http://localhost:3000/agents/<agent_id>/stop
```

The runner polls its own `status` field every tick and exits cleanly when
it sees `stopped`.

## Config reference (building blocks)

| Field | Options |
|---|---|
| `config.signal.type` | `odds_movement`, `score_state`, `mean_reversion`, `momentum`, `time_decay`, `volatility_spike` |
| `config.sizing.type` | `fixed`, `percent_of_budget`, `confidence_weighted` |
| `config.exit.type` | `stop_loss_take_profit`, `time_based`, `signal_reversal` |
| `config.aggression.type` | `instant`, `confirmation`, `cooldown` |
| `config.direction` | `long_only`, `short_only`, `bidirectional` |

## Notes / what to adjust before the hackathon demo

- `src/lib/txline.js` guesses at TxLINE's response shape (`odds`, `score`,
  `minute`, `event`). Check the real quickstart docs
  (https://txline.txodds.com/documentation/quickstart) and adjust the
  mapping in `fetchOddsSnapshot`.
- `aggression.type` (`confirmation`, `cooldown`) is accepted by the schema
  but not yet enforced in `strategyEngine.js` — currently every tick reacts
  instantly. Add a small state machine in `evaluateSignal`/`agentRunner.js`
  to require N consecutive signals or a cooldown timer if you want that
  behavior for the demo.
- Only one position is held open at a time per agent, kept intentionally
  simple for a 5-minute demo video.
- On-chain settlement (Solana) isn't wired up yet — this gives you the full
  off-chain engine; anchoring final balances on-chain is a good next step
  once the trading logic is solid.
