import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import { PredictionPot } from "../target/types/prediction_pot";

describe("prediction_pot", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.PredictionPot as Program<PredictionPot>;

  const matchId = "wc-2026-test-" + Math.floor(Math.random() * 1e6);
  const authority = provider.wallet as anchor.Wallet;

  const alice = Keypair.generate(); // bets side A (home)
  const bob = Keypair.generate();   // bets side B (away)

  let marketPda: PublicKey;

  before(async () => {
    // Airdrop devnet/localnet SOL to the two test betters
    for (const kp of [alice, bob]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig, "confirmed");
    }
    [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), Buffer.from(matchId)],
      program.programId
    );
  });

  it("initializes a market", async () => {
    await program.methods
      .initializeMarket(matchId)
      .accounts({ authority: authority.publicKey, market: marketPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    assert.equal(market.matchId, matchId);
    assert.equal(market.poolA.toNumber(), 0);
    assert.equal(market.poolB.toNumber(), 0);
  });

  it("accepts bets on both sides", async () => {
    const [alicePos] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), marketPda.toBuffer(), alice.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .placeBet(0, new anchor.BN(1 * LAMPORTS_PER_SOL))
      .accounts({ better: alice.publicKey, market: marketPda, position: alicePos, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([alice])
      .rpc();

    const [bobPos] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), marketPda.toBuffer(), bob.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .placeBet(1, new anchor.BN(0.5 * LAMPORTS_PER_SOL))
      .accounts({ better: bob.publicKey, market: marketPda, position: bobPos, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([bob])
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    assert.equal(market.poolA.toNumber(), 1 * LAMPORTS_PER_SOL);
    assert.equal(market.poolB.toNumber(), 0.5 * LAMPORTS_PER_SOL);
  });

  it("resolves the market and pays the winner", async () => {
    await program.methods
      .resolveMarket(0) // side A (Alice/home) won
      .accounts({ authority: authority.publicKey, market: marketPda })
      .rpc();

    const [alicePos] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), marketPda.toBuffer(), alice.publicKey.toBuffer()],
      program.programId
    );

    const balanceBefore = await provider.connection.getBalance(alice.publicKey);

    await program.methods
      .claimPayout()
      .accounts({ better: alice.publicKey, market: marketPda, position: alicePos })
      .signers([alice])
      .rpc();

    const balanceAfter = await provider.connection.getBalance(alice.publicKey);
    // Alice staked 1 SOL and should get her stake back plus ~all of Bob's 0.5 SOL pool
    assert.isAbove(balanceAfter - balanceBefore, 1.4 * LAMPORTS_PER_SOL);
  });

  it("rejects a second claim on the same position", async () => {
    const [alicePos] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), marketPda.toBuffer(), alice.publicKey.toBuffer()],
      program.programId
    );
    try {
      await program.methods
        .claimPayout()
        .accounts({ better: alice.publicKey, market: marketPda, position: alicePos })
        .signers([alice])
        .rpc();
      assert.fail("expected AlreadyClaimed error");
    } catch (err) {
      assert.include(String(err), "AlreadyClaimed");
    }
  });

  it("rejects a claim from the losing side", async () => {
    const [bobPos] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), marketPda.toBuffer(), bob.publicKey.toBuffer()],
      program.programId
    );
    try {
      await program.methods
        .claimPayout()
        .accounts({ better: bob.publicKey, market: marketPda, position: bobPos })
        .signers([bob])
        .rpc();
      assert.fail("expected NotAWinner error");
    } catch (err) {
      assert.include(String(err), "NotAWinner");
    }
  });
});
