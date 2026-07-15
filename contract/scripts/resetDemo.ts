// One-shot demo reset: spins up a brand-new match_id + house wallet + funds it,
// so you can re-run the whole demo cleanly with a single command.
//
// Usage:
//   ts-node scripts/resetDemo.ts
//
// This will:
// 1. Generate a unique match_id (timestamp-based)
// 2. Generate a fresh house wallet
// 3. Fund the house wallet via airdrop
// 4. Initialize the market
// 5. Seed the house counterparty stake
//
// Output includes the new match_id and house wallet path for use in subsequent commands.

import * as anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import { execSync } from "child_process";
import { PredictionPot } from "../target/types/prediction_pot";

const HOUSE_STAKE_SOL = 2;
const HOUSE_AIRDROP_SOL = 5;

function loadKeypair(path: string): Keypair {
  const expanded = path.replace(/^~/, os.homedir());
  const secret = JSON.parse(fs.readFileSync(expanded, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function marketPda(program: anchor.Program<PredictionPot>, matchId: string) {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from(matchId)],
    program.programId
  )[0];
}

function positionPda(program: anchor.Program<PredictionPot>, market: anchor.web3.PublicKey, better: anchor.web3.PublicKey) {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), better.toBuffer()],
    program.programId
  )[0];
}

async function airdropWithRetry(pubkey: string, amount: number, maxRetries = 3): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`Airdropping ${amount} SOL to ${pubkey} (attempt ${i + 1}/${maxRetries})...`);
      execSync(`solana airdrop ${amount} ${pubkey} --url devnet`, { stdio: "inherit" });
      console.log("Airdrop successful!");
      return;
    } catch (error) {
      console.log(`Airdrop failed (rate-limited), retrying in 3 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  console.log(`\n=== Airdrop failed after ${maxRetries} attempts ===`);
  console.log(`Please fund the wallet manually using the web faucet:`);
  console.log(`https://faucet.solana.com/`);
  console.log(`Wallet pubkey: ${pubkey}`);
  console.log(`Amount needed: ${amount} SOL`);
  console.log(`After funding, press Enter to continue...`);
  
  // Wait for user to fund manually
  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });
  
  // Verify balance
  const balanceOutput = execSync(`solana balance ${pubkey} --url devnet`).toString();
  const balance = parseFloat(balanceOutput.trim().split(' ')[0]);
  if (balance < amount) {
    throw new Error(`Insufficient balance after manual funding. Expected ${amount} SOL, got ${balance} SOL`);
  }
  console.log("Balance verified!");
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.PredictionPot as anchor.Program<PredictionPot>;

  // Generate unique match_id with timestamp
  const timestamp = Date.now();
  const matchId = `demo-${timestamp}`;
  console.log(`Generated match_id: ${matchId}`);

  // Use existing house wallet if available, otherwise generate new one
  let houseWalletPath = process.argv[2];
  let house: Keypair;
  
  if (houseWalletPath && fs.existsSync(houseWalletPath)) {
    console.log(`Using existing house wallet at ${houseWalletPath}...`);
    house = loadKeypair(houseWalletPath);
    console.log(`House wallet pubkey: ${house.publicKey.toBase58()}`);
  } else {
    houseWalletPath = `/tmp/house-${timestamp}.json`;
    console.log(`Generating house wallet at ${houseWalletPath}...`);
    execSync(`solana-keygen new --outfile ${houseWalletPath} --no-bip39-passphrase`, { stdio: "inherit" });
    house = loadKeypair(houseWalletPath);
    console.log(`House wallet pubkey: ${house.publicKey.toBase58()}`);

    // Fund house wallet
    await airdropWithRetry(house.publicKey.toBase58(), HOUSE_AIRDROP_SOL);
  }

  // Verify balance
  const balance = execSync(`solana balance ${house.publicKey.toBase58()} --url devnet`).toString();
  console.log(`House wallet balance: ${balance.trim()}`);

  // Initialize market
  console.log(`Initializing market for ${matchId}...`);
  const market = marketPda(program, matchId);
  const authority = provider.wallet as anchor.Wallet;
  const initSig = await program.methods
    .initializeMarket(matchId)
    .accountsStrict({
      authority: authority.publicKey,
      market,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
  console.log(`Market initialized: ${market.toBase58()}, tx: ${initSig}`);

  // Seed house counterparty stake
  console.log(`Seeding house counterparty stake (${HOUSE_STAKE_SOL} SOL)...`);
  const acct = await program.account.market.fetch(market);
  const poolA = (acct as any).poolA || (acct as any).pool_a;
  const poolB = (acct as any).poolB || (acct as any).pool_b;
  const side = poolA.lt(poolB) ? 0 : 1;

  const position = positionPda(program, market, house.publicKey);
  const betSig = await program.methods
    .placeBet(side, new anchor.BN(HOUSE_STAKE_SOL * LAMPORTS_PER_SOL))
    .accountsStrict({
      better: house.publicKey,
      market,
      position,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([house])
    .rpc();
  console.log(`House bet ${HOUSE_STAKE_SOL} SOL on side ${side}, tx: ${betSig}`);

  // Show final state
  const finalAcct = await program.account.market.fetch(market);
  console.log("\n=== Demo Setup Complete ===");
  console.log(`Match ID: ${matchId}`);
  console.log(`House wallet: ${house.publicKey.toBase58()}`);
  console.log(`House wallet path: ${houseWalletPath}`);
  console.log(`House stake: ${HOUSE_STAKE_SOL} SOL on side ${side}`);
  console.log(`Pool A: ${(poolA.toNumber() / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
  console.log(`Pool B: ${(poolB.toNumber() / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
  console.log(`Status: ${JSON.stringify(finalAcct.status)}`);
  console.log("\n=== Next Steps ===");
  console.log(`# Have agents bet on the opposite side:`);
  console.log(`ts-node scripts/cli.ts bet --match ${matchId} --side 0 --sol 0.5 --keypair /tmp/agent1.json`);
  console.log(`\n# Check pool state:`);
  console.log(`ts-node scripts/cli.ts show --match ${matchId}`);
  console.log(`\n# When ready to settle:`);
  console.log(`ts-node scripts/cli.ts lock --match ${matchId}`);
  console.log(`ts-node scripts/cli.ts resolve --match ${matchId} --winner 0`);
  console.log(`\n# Claim payouts:`);
  console.log(`ts-node scripts/cli.ts claim --match ${matchId} --keypair /tmp/agent1.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
