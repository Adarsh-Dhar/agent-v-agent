// Thin wrapper around @coral-xyz/anchor for talking to the deployed
// `prediction_pot` program. Everything that used to be simulated in
// agentRunner.js (balance math, PnL) now happens for real here: SOL moves
// trader -> vault on open, vault -> trader on close.
//
// SETUP REQUIRED before this file will work:
//   1. `cd contract && anchor build && anchor deploy --provider.cluster devnet`
//   2. Copy the generated IDL to server/src/idl/prediction_pot.json:
//        cp contract/target/idl/prediction_pot.json server/src/idl/prediction_pot.json
//   3. Generate a market-authority keypair (this backend signs as the
//      program's `authority` -- it's the "oracle" that submits exit odds):
//        solana-keygen new --outfile server/market-authority-keypair.json
//   4. Fund that keypair on devnet (web faucet is more reliable than
//      requestAirdrop, which is aggressively rate-limited):
//        solana airdrop 2 <pubkey> --url devnet
//   5. Set the env vars below in server/.env (see .env.example).
//
// UNITS: budget_cap / stake in the agent config are now interpreted as
// devnet SOL directly (not an abstract currency). A $500 "budget_cap" in
// the old sim becomes 0.5 in the new config if you want to keep values
// small enough to fund easily on devnet -- adjust to taste, just be
// consistent, since this is the exact amount airdropped/transferred into
// the run's wallet.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import * as anchor from '@coral-xyz/anchor';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
} from '@solana/web3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey(
  process.env.PREDICTION_POT_PROGRAM_ID || '7qQaQpaS5oiSYSgq9o5LzJ1EPBMLdbGzrhBMertmpDeU'
);
const HOUSE_SEED_SOL = Number(process.env.HOUSE_SEED_SOL ?? 5);

function expandHome(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function loadKeypairFromFile(keypairPath) {
  const raw = JSON.parse(fs.readFileSync(expandHome(keypairPath), 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function keypairFromSecretArray(secretArray) {
  return Keypair.fromSecretKey(Uint8Array.from(secretArray));
}

const idlPath =
  process.env.PREDICTION_POT_IDL_PATH || path.join(__dirname, '../idl/prediction_pot.json');
let idl;
try {
  idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
} catch (err) {
  throw new Error(
    `Couldn't load program IDL from ${idlPath}. Run \`anchor build\` in contract/ and copy ` +
      `target/idl/prediction_pot.json here first. (${err.message})`
  );
}

export const connection = new Connection(RPC_URL, 'confirmed');

const authorityKeypair = loadKeypairFromFile(
  process.env.MARKET_AUTHORITY_KEYPAIR_PATH || './market-authority-keypair.json'
);

function programFor(signerKeypair) {
  const wallet = new anchor.Wallet(signerKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  return new anchor.Program(idl, provider);
}

const authorityProgram = programFor(authorityKeypair);

export function marketPda(matchId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('market'), Buffer.from(matchId)],
    PROGRAM_ID
  )[0];
}

export function positionPda(market, trader, tradeId) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('position'),
      market.toBuffer(),
      trader.toBuffer(),
      new anchor.BN(tradeId).toArrayLike(Buffer, 'le', 8),
    ],
    PROGRAM_ID
  )[0];
}

export function oddsToBps(odds) {
  return Math.round(odds * 10000);
}

export function solToLamports(sol) {
  return Math.round(sol * LAMPORTS_PER_SOL);
}

/** Generates a fresh devnet wallet for a run and funds it with `solAmount`. */
export async function createFundedRunWallet(solAmount) {
  const kp = Keypair.generate();
  // Transfer from the authority wallet rather than requestAirdrop for each
  // agent -- devnet's airdrop faucet is rate-limited per IP and will start
  // failing fast if every new run tries to hit it directly.
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: authorityKeypair.publicKey,
      toPubkey: kp.publicKey,
      lamports: solToLamports(solAmount) + solToLamports(0.01), // pad for tx fees/rent
    })
  );
  const sig = await authorityProgram.provider.sendAndConfirm(tx, [authorityKeypair]);
  return { keypair: kp, signature: sig };
}

/** Idempotently creates + house-seeds the on-chain market for a match_id. */
export async function ensureMarket(matchId) {
  const market = marketPda(matchId);
  const existing = await connection.getAccountInfo(market);
  if (existing) return market;

  await authorityProgram.methods
    .initializeMarket(matchId)
    .accounts({
      authority: authorityKeypair.publicKey,
      market,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const seedTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: authorityKeypair.publicKey,
      toPubkey: market,
      lamports: solToLamports(HOUSE_SEED_SOL),
    })
  );
  await authorityProgram.provider.sendAndConfirm(seedTx, [authorityKeypair]);

  return market;
}

/**
 * Opens a real on-chain position. `side` is 'buy' | 'sell'. `tradeId` must
 * not have been used before by this trader in this market (the agent's
 * running trade_count works fine as the nonce, since a fresh wallet is
 * minted per run -- see server.js).
 */
export async function openPositionOnChain({ traderKeypair, matchId, tradeId, side, stakeSol, entryOdds }) {
  const market = marketPda(matchId);
  const position = positionPda(market, traderKeypair.publicKey, tradeId);
  const program = programFor(traderKeypair);

  const signature = await program.methods
    .openPosition(new anchor.BN(tradeId), side === 'buy' ? 0 : 1, new anchor.BN(solToLamports(stakeSol)), oddsToBps(entryOdds))
    .accounts({
      trader: traderKeypair.publicKey,
      market,
      position,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return { signature, position };
}

/**
 * Closes a position immediately, marking to market against `exitOdds`.
 * Signed by the backend's authority key -- see the trust-assumption note
 * on close_position in lib.rs.
 */
export async function closePositionOnChain({ matchId, traderPubkey, tradeId, exitOdds }) {
  const market = marketPda(matchId);
  const position = positionPda(market, traderPubkey, tradeId);

  const signature = await authorityProgram.methods
    .closePosition(new anchor.BN(tradeId), oddsToBps(exitOdds))
    .accounts({
      authority: authorityKeypair.publicKey,
      market,
      trader: traderPubkey,
      position,
    })
    .rpc();

  return { signature };
}

export async function getWalletBalanceSol(pubkey) {
  const lamports = await connection.getBalance(pubkey, 'confirmed');
  return lamports / LAMPORTS_PER_SOL;
}

export async function getPositionAccount(matchId, traderPubkey, tradeId) {
  const market = marketPda(matchId);
  const position = positionPda(market, traderPubkey, tradeId);
  try {
    return await authorityProgram.account.position.fetch(position);
  } catch {
    return null;
  }
}
