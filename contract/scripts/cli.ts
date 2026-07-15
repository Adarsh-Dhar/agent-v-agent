// Manual, one-instruction-at-a-time CLI for prediction_pot.
// Usage (after `anchor build` + `anchor deploy`):
//
//   ts-node scripts/cli.ts init-market --match wc-2026-final
//   ts-node scripts/cli.ts bet --match wc-2026-final --side 0 --sol 0.1 --keypair ~/.config/solana/id.json
//   ts-node scripts/cli.ts lock --match wc-2026-final
//   ts-node scripts/cli.ts resolve --match wc-2026-final --winner 0
//   ts-node scripts/cli.ts claim --match wc-2026-final --keypair ~/.config/solana/id.json
//   ts-node scripts/cli.ts show --match wc-2026-final
//
// Reads cluster + wallet from Anchor.toml / ANCHOR_PROVIDER_URL / ANCHOR_WALLET,
// same as `anchor test`/`anchor deploy` do.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import { PredictionPot } from "../target/types/prediction_pot";

function loadKeypair(path: string): Keypair {
  const expanded = path.replace(/^~/, os.homedir());
  const secret = JSON.parse(fs.readFileSync(expanded, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing --${name}`);
  }
  return process.argv[i + 1];
}

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
  const cmd = process.argv[2];
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.PredictionPot as Program<PredictionPot>;
  const authority = provider.wallet as anchor.Wallet;

  const matchId = arg("match");
  const market = marketPda(program, matchId);

  switch (cmd) {
    case "init-market": {
      const sig = await program.methods
        .initializeMarket(matchId)
        .accounts({ authority: authority.publicKey })
        .rpc();
      console.log("market initialized:", market.toBase58(), "tx:", sig);
      break;
    }

    case "bet": {
      const side = Number(arg("side"));
      const sol = Number(arg("sol"));
      const better = loadKeypair(arg("keypair"));
      const position = positionPda(program, market, better.publicKey);
      const sig = await program.methods
        .placeBet(side, new anchor.BN(sol * LAMPORTS_PER_SOL))
        .accounts({ better: better.publicKey })
        .signers([better])
        .rpc();
      console.log(`bet placed: side=${side} sol=${sol} tx:`, sig);
      break;
    }

    case "lock": {
      const sig = await program.methods.lockMarket().accounts({ authority: authority.publicKey, market }).rpc();
      console.log("market locked, tx:", sig);
      break;
    }

    case "resolve": {
      const winner = Number(arg("winner"));
      const sig = await program.methods
        .resolveMarket(winner)
        .accounts({ authority: authority.publicKey, market })
        .rpc();
      console.log(`market resolved: winner=${winner} tx:`, sig);
      break;
    }

    case "claim": {
      const better = loadKeypair(arg("keypair"));
      const position = positionPda(program, market, better.publicKey);
      const sig = await program.methods
        .claimPayout()
        .accounts({ better: better.publicKey, market, position })
        .signers([better])
        .rpc();
      console.log("claimed, tx:", sig);
      break;
    }

    case "show": {
      const acct = await program.account.market.fetch(market);
      console.log(JSON.stringify({
        matchId: acct.matchId,
        poolA_SOL: acct.poolA.toNumber() / LAMPORTS_PER_SOL,
        poolB_SOL: acct.poolB.toNumber() / LAMPORTS_PER_SOL,
        status: acct.status,
        winningSide: acct.winningSide,
      }, null, 2));
      break;
    }

    default:
      console.error("unknown command. use: init-market | bet | lock | resolve | claim | show");
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
