# Agent v Agent — TxLINE World Cup Trading Agents

Turn a live football odds feed into a competitive, no-code algorithmic
trading game. Configure autonomous trading agents from simple strategy
building blocks, pit them head-to-head on real (or replayed) matches, and
settle results on-chain via a Solana Anchor program.

This repo has three parts:

```
frontend/   Next.js app — create agents/matches, view leaderboard (talks to Supabase)
server/     Node/Express backend — runs each agent as its own process, talks to TxLINE
contract/   Anchor/Rust program — on-chain escrow + settlement (prediction_pot)
```

---

## 1. Prerequisites

- Node.js 18+ and npm (or pnpm)
- A free [Supabase](https://supabase.com) project
- (Optional, for real data) TxLINE API credentials + a funded Solana devnet wallet
- (Optional, for on-chain settlement) Anchor CLI + Solana CLI, if you want to rebuild/redeploy the contract

You can run the whole thing **without** TxLINE or Solana credentials — the
server falls back to a scripted mock odds/score feed automatically.

---

## 2. Set up Supabase (database)

1. Create a project at [app.supabase.com](https://app.supabase.com/projects).
2. Open the **SQL Editor** and run, in order:
   1. `sql-files/schema.sql` — core tables (`agents`, `trades`, etc.)
   2. `sql-files/create_matches_tables.sql` — `matches` / `match_players`
   3. `sql-files/create_games_table.sql` — real-world `games` (e.g. Argentina vs Switzerland)
   4. Every remaining file in `sql-files/` in filename order (e.g. `007_ticks_granular.sql` → `010_add_initial_purse_to_matches.sql`, then the `add_*.sql` files) — these are additive migrations (new columns/indexes) and are safe to run repeatedly (`IF NOT EXISTS` guarded).
3. Grab from **Project Settings → API**:
   - `Project URL`
   - `anon public` key
   - `service_role` key (keep this secret — server-side only)

> `frontend/DATABASE_SCHEMA.md`, `SETUP_MATCHES_PURSE.md`, and
> `SETUP_REPLAY_SQL.md` contain the same SQL inline plus extra context if you
> want to read the reasoning behind any one migration.

---

## 3. Run the frontend

```bash
cd frontend
npm install
```

Create `frontend/.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
DATABASE_URL=your_supabase_postgres_connection_string   # used by drizzle-orm
AGENT_SERVER_URL=http://localhost:5000                  # the server from step 4
```

```bash
npm run dev
```

App runs at **http://localhost:3000**.

---

## 4. Run the agent server

```bash
cd server
npm install
cp .env.example .env
```

Minimum viable `.env` (no live TxLINE/Solana needed — mock data kicks in automatically):

```bash
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
PORT=5000
TXLINE_MOCK_DATASET=arg-vs-sui
```

To use **real** TxLINE data instead of the mock feed, also fill in:

```bash
TXLINE_NETWORK=devnet
TXLINE_API_ORIGIN=https://txline-dev.txodds.com
TXLINE_WALLET_KEYPAIR_PATH=./txline-devnet-keypair.json
TXLINE_SUBSCRIBE_TX_SIG=your_subscription_transaction_signature
```

Then run the one-time activation script (exchanges your on-chain
subscription signature for a long-lived API token, which it writes back to `.env`):

```bash
npm run activate:txline
```

Start the server:

```bash
npm start
```

Server runs at **http://localhost:5000**. Every agent you create runs as its
own child process, with logs streamed directly into this terminal.

### Quick manual test (optional)

```bash
curl -X POST http://localhost:5000/agents \
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

curl http://localhost:5000/matches/wc-2026-final/leaderboard
```

---

## 5. (Optional) Solana contract

Only needed if you want to rebuild or redeploy the on-chain settlement
program yourself — the server ships with a working devnet program ID and
IDL already wired up (`PREDICTION_POT_PROGRAM_ID` / `src/idl/prediction_pot.json`
in `server/.env.example`), so this step is skippable for a normal local demo.

```bash
cd contract
yarn install
anchor build
anchor keys sync      # updates the program's declare_id! if needed
anchor deploy --provider.cluster devnet
```

See `contract/scripts/demo.ts` and `contract/scripts/cli.ts` for scripted
examples of initializing a market, opening/closing positions, and seeding
house capital.

---

## 6. Typical local flow, end to end

1. Start Supabase (already hosted), the `server`, and the `frontend`.
2. In the frontend, go to `/agents/create` and build an agent (pick a
   signal, sizing, exit, aggression, and direction).
3. Go to `/matches/create`, pick a game (e.g. "Argentina vs Switzerland"),
   and create a match.
4. Join the match with an agent, then start it (`/matches/[code]/run`).
5. Watch the server terminal for live per-tick trade logs, and the match
   page / `/leaderboard` for live PnL.

---

## What Judges Need to Know

**The idea:** a no-code algorithmic-trading arena built on real, live sports
odds (TxLINE) instead of financial markets — agents are assembled from five
composable strategy blocks (signal, sizing, exit, aggression, direction)
rather than written as code, and compete head-to-head on the same live match.

**What's real vs. simulated right now:**
- Odds/score ingestion, the strategy engine, per-agent process execution,
  and PnL tracking are fully functional end-to-end, backed by Supabase.
- A working Solana/Anchor program (`prediction_pot`) exists and is deployed
  to devnet — it escrows stakes, opens/closes positions with the same PnL
  formula as the off-chain engine, and settles losses clamped to the
  escrowed stake. **Market settlement is currently signed by the backend
  itself** (there's no independent on-chain price oracle yet) — this is a
  known, documented trust assumption for the current build stage, not a bug.
- If TxLINE credentials aren't configured (or a live call fails), the
  system automatically falls back to a scripted mock odds/score feed so the
  full pipeline is always demoable — fallback ticks are explicitly tagged
  (`isMock: true`), never silently passed off as live data.

**Notable engineering work:**
- Reverse-engineered TxLINE's actual (undocumented-for-this-use-case)
  response shapes: odds snapshots are a flat array keyed by
  `SuperOddsType`/`MarketPeriod`/`MarketParameters` rather than a
  `{markets:[...]}` object, and score snapshots come back sorted
  alphabetically by action name rather than chronologically — both required
  custom parsing logic (see `server/src/lib/txline.js`).
- A replay/backtesting engine (`replay-{fixtureId}` match IDs) lets agents
  run against real historical match timelines for repeatable testing.
- A recent hardening pass fixed a fragile `initial_purse` bug (previously
  derived from the first player's row instead of stored on the match
  itself) and added status guards so agents can't be swapped mid-match.

**Where to look in the code:**
- Strategy logic: `server/src/lib/strategyEngine.js`, `server/src/agentRunner.js`
- TxLINE client: `server/src/lib/txline.js`
- On-chain program: `contract/programs/prediction_pot/src/lib.rs`
- Frontend agent/match flows: `frontend/app/agents/create`, `frontend/app/matches`

**Known limitations (by design, for this build stage):**
- Only one open position per agent at a time.
- `aggression.type` values `confirmation`/`cooldown` are accepted by the
  config schema but not yet enforced by the strategy engine — every tick
  currently reacts instantly.
- No independent on-chain price oracle; the market authority signer is the
  same backend process reading TxLINE.