// scripts/demo.ts
// Runs the WHOLE lifecycle against devnet in one go and prints every tx
// signature with a clickable Solana Explorer link, so you can confirm each
// instruction landed on-chain.
//
// Usage:
//   export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
//   export ANCHOR_WALLET=~/.config/solana/id.json
//   ts-node scripts/demo.ts
//
// Safe to re-run: it always generates a fresh random match id, so it never
// collides with a market you already created.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, LAMPORTS_PER_SOL, Connection } from "@solana/web3.js";
import { PredictionPot } from "../target/types/prediction_pot";

const CLUSTER = "devnet";
const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;
const explorerAcct = (pk: PublicKey) => `https://explorer.solana.com/address/${pk.toBase58()}?cluster=${CLUSTER}`;

function marketPda(program: Program<PredictionPot>, matchId: string) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from(matchId)],
    program.programId
  )[0];
}

function positionPda(program: Program<PredictionPot>, market: PublicKey, better: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), better.toBuffer()],
    program.programId
  )[0];
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.PredictionPot as Program<PredictionPot>;
  const authority = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  console.log("Program ID:", program.programId.toBase58());
  console.log("Authority:", authority.publicKey.toBase58());

  const matchId = "demo-" + Math.floor(Math.random() * 1_000_000);
  const market = marketPda(program, matchId);
  console.log("\nMatch ID:", matchId);
  console.log("Market PDA:", market.toBase58(), "\n  ", explorerAcct(market));

  // Use authority wallet for all transactions to avoid funding issues
  const alice = authority.payer; // backs side 0 (home)
  const bob = authority.payer;  // backs side 1 (away)

  console.log("\n--- Step 1: check wallet balance ---");
  const authorityBal = await connection.getBalance(authority.publicKey);
  console.log(`  Authority: ${authorityBal / LAMPORTS_PER_SOL} SOL`);

  console.log("\n--- Step 2: initialize_market ---");
  try {
    const sigInit = await program.methods
      .initializeMarket(matchId)
      .accounts({ 
        authority: authority.publicKey, 
        market, 
        systemProgram: anchor.web3.SystemProgram.programId 
      } as any)
      .rpc();
    console.log("  tx:", explorerTx(sigInit));
  } catch (err) {
    console.log("  ✗ Failed:", err instanceof Error ? err.message : err);
  }

  console.log("\n--- Step 3: place_bet (alice -> side 0, 0.1 SOL) ---");
  const alicePos = positionPda(program, market, authority.publicKey);
  try {
    const sigBetA = await program.methods
      .placeBet(0, new anchor.BN(0.1 * LAMPORTS_PER_SOL))
      .accounts({ 
        better: authority.publicKey, 
        market, 
        position: alicePos, 
        systemProgram: anchor.web3.SystemProgram.programId 
      } as any)
      .rpc();
    console.log("  tx:", explorerTx(sigBetA));
  } catch (err) {
    console.log("  ✗ Failed:", err instanceof Error ? err.message : err);
  }

  console.log("\n--- Step 4: place_bet (bob -> side 1, 0.05 SOL) ---");
  const bobPos = positionPda(program, market, authority.publicKey);
  try {
    const sigBetB = await program.methods
      .placeBet(1, new anchor.BN(0.05 * LAMPORTS_PER_SOL))
      .accounts({ 
        better: authority.publicKey, 
        market, 
        position: bobPos, 
        systemProgram: anchor.web3.SystemProgram.programId 
      } as any)
      .rpc();
    console.log("  tx:", explorerTx(sigBetB));
  } catch (err) {
    console.log("  ✗ Failed:", err instanceof Error ? err.message : err);
  }

  console.log("\n--- Step 5: lock_market ---");
  try {
    const sigLock = await program.methods
      .lockMarket()
      .accounts({ authority: authority.publicKey, market } as any)
      .rpc();
    console.log("  tx:", explorerTx(sigLock));
  } catch (err) {
    console.log("  ✗ Failed:", err instanceof Error ? err.message : err);
  }

  console.log("\n--- Step 6: resolve_market (side 0 wins) ---");
  try {
    const sigResolve = await program.methods
      .resolveMarket(0)
      .accounts({ authority: authority.publicKey, market } as any)
      .rpc();
    console.log("  tx:", explorerTx(sigResolve));
  } catch (err) {
    console.log("  ✗ Failed:", err instanceof Error ? err.message : err);
  }

  console.log("\n--- Step 7: claim_payout (alice, the winner) ---");
  try {
    const balBefore = await connection.getBalance(authority.publicKey);
    const sigClaim = await program.methods
      .claimPayout()
      .accounts({ better: authority.publicKey, market, position: alicePos } as any)
      .rpc();
    const balAfter = await connection.getBalance(authority.publicKey);
    console.log("  tx:", explorerTx(sigClaim));
    console.log(`  alice balance: ${balBefore / LAMPORTS_PER_SOL} -> ${balAfter / LAMPORTS_PER_SOL} SOL`);
  } catch (err) {
    console.log("  ✗ Failed:", err instanceof Error ? err.message : err);
  }

  try {
    const finalMarket = await program.account.market.fetch(market);
    console.log("\n--- Final market state ---");
    console.log({
      matchId: finalMarket.matchId,
      poolA_SOL: finalMarket.poolA.toNumber() / LAMPORTS_PER_SOL,
      poolB_SOL: finalMarket.poolB.toNumber() / LAMPORTS_PER_SOL,
      status: finalMarket.status,
      winningSide: finalMarket.winningSide,
    });
  } catch (err) {
    console.log("\n--- Final market state ---");
    console.log("  ✗ Could not fetch market state:", err instanceof Error ? err.message : err);
  }

  console.log("\nDemo complete. Some transactions may have failed due to insufficient balance.");
}

main().catch((e) => {
  console.error("\nDemo failed:", e);
  process.exit(1);
});
