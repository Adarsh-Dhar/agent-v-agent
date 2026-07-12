-- Run this in the Supabase SQL editor before starting the server.

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  match_id text not null,
  owner text,                          -- e.g. wallet address or username
  status text not null default 'created', -- created | running | stopped | error | finished
  budget_cap numeric not null,
  config jsonb not null,                -- full strategy config (signal, sizing, exit, aggression, etc.)
  balance numeric not null,              -- live running balance, starts equal to budget_cap
  realized_pnl numeric not null default 0,
  unrealized_pnl numeric not null default 0,
  trade_count integer not null default 0,
  pid integer,                           -- OS process id of the running agent, for debugging/killing
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists trades (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  match_id text not null,
  side text not null,                    -- 'buy' | 'sell'
  odds numeric not null,
  stake numeric not null,
  reason text,                           -- which signal fired
  created_at timestamptz not null default now()
);

create index if not exists idx_trades_agent_id on trades(agent_id);
create index if not exists idx_agents_match_id on agents(match_id);
