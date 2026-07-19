-- Run after schema.sql. Adds the on-chain wallet a run trades with.
-- One fresh devnet keypair is minted per run (see server.js), funded with
-- `budget_cap` SOL, and used as the `trader` signer for open_position.
--
-- wallet_secret_key is stored as the raw secret key byte array (jsonb),
-- same shape Solana CLI keypair files use. This is fine for a devnet MVP
-- where the backend already fully controls these wallets; don't reuse this
-- pattern for mainnet funds without a proper secrets manager / KMS.

ALTER TABLE public.agent_runs
ADD COLUMN IF NOT EXISTS wallet_pubkey TEXT,
ADD COLUMN IF NOT EXISTS wallet_secret_key JSONB;

CREATE INDEX IF NOT EXISTS agent_runs_wallet_pubkey_idx ON public.agent_runs(wallet_pubkey);
