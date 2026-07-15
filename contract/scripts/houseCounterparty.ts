// House counterparty: seeds the weaker side of a market with the house's
// own SOL so real agents have a genuine losing pool to win against, instead
// of a zero-sum pot where everyone agreeing means nobody profits.
//
// CONSTRAINT: the contract allows exactly one bet per (market, wallet).
// A single house keypair can therefore only enter a given market ONCE.
// Size HOUSE_STAKE_SOL generously up front rather than planning to "top up"
// with the same wallet — see fundNewHouseWallet() at the bottom if you need
// a second injection into the same match later.

import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import { PredictionPot } from "../target/types/prediction_pot";

const HOUSE_STAKE_SOL = Number(process.env.HOUSE_STAKE_SOL || 2);

function loadKeypair(path: string): Keypair {
  const expanded = path.replace(/^~/, os.homedir());
  const secret = JSON.parse(fs.readFileSync(expanded, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function marketPda(program: anchor.Program<PredictionPot>, matchId: string) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from(matchId)],
    program.programId
  )[0];
}

function positionPda(program: anchor.Program<PredictionPot>, market: PublicKey, better: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), better.toBuffer()],
    program.programId
  )[0];
}

async function ensureLiquidity(
  program: anchor.Program<PredictionPot>,
  house: Keypair,
  matchId: string
) {
  const market = marketPda(program, matchId);
  const acct = await program.account.market.fetchNullable(market);

  if (!acct) {
    console.log(`market ${matchId} doesn't exist yet — run init-market first.`);
    return;
  }
  if (JSON.stringify(acct.status) !== JSON.stringify({ open: {} })) {
    console.log(`market ${matchId} is not open (status=${JSON.stringify(acct.status)}), skipping.`);
    return;
  }

  const position = positionPda(program, market, house.publicKey);
  const existing = await program.account.position.fetchNullable(position);
  if (existing) {
    console.log(`house already has a position in ${matchId} — one bet per wallet per market, skipping.`);
    return;
  }

  // Bet whichever side currently has less staked (or side 0 if it's a brand
  // new market with nothing in it yet).
  const poolA = (acct as any).poolA || (acct as any).pool_a;
  const poolB = (acct as any).poolB || (acct as any).pool_b;
  const side = poolA.lt(poolB) ? 0 : 1;

  const sig = await program.methods
    .placeBet(side, new anchor.BN(HOUSE_STAKE_SOL * LAMPORTS_PER_SOL))
    .accountsStrict({
      better: house.publicKey,
      market,
      position,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([house])
    .rpc();

  console.log(`house bet ${HOUSE_STAKE_SOL} SOL on side ${side} for ${matchId}, tx: ${sig}`);
}

async function main() {
  const matchId = process.argv[2];
  if (!matchId) {
    console.error("usage: ts-node scripts/houseCounterparty.ts <match_id> [house-keypair-path]");
    process.exit(1);
  }
  const keypairPath = process.argv[3] || "/tmp/house.json";

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.PredictionPot as anchor.Program<PredictionPot>;
  const house = loadKeypair(keypairPath);

  console.log(`house wallet: ${house.publicKey.toBase58()}`);
  await ensureLiquidity(program, house, matchId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
