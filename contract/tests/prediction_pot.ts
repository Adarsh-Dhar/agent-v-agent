import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import { PredictionPot } from "../target/types/prediction_pot";

describe("prediction_pot", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.PredictionPot as Program<PredictionPot>;

  const matchId = "wc-2026-test-" + Math.floor(Math.random() * 1e6);
  const authority = provider.wallet as anchor.Wallet;

  // Use provider wallet for all traders to avoid airdrop rate limits
  const alice = authority; 
  const bob = authority;

  let marketPda: PublicKey;

  function positionPda(market: PublicKey, trader: PublicKey, tradeId: number) {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        market.toBuffer(),
        trader.toBuffer(),
        new anchor.BN(tradeId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    )[0];
  }

  before(async () => {
    [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), Buffer.from(matchId)],
      program.programId
    );
  });

  it("initializes a market", async () => {
    await program.methods
      .initializeMarket(matchId)
      .accounts({ authority: authority.publicKey, market: marketPda, systemProgram: SystemProgram.programId })
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    assert.equal(market.matchId, matchId);
    assert.deepEqual(market.status, { open: {} });
  });

  it("seeds house capital into the vault", async () => {
    // Plain lamport transfer from authority wallet to seed house capital
    const tx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: marketPda,
        lamports: 5 * LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(tx, [authority.payer]);

    const balance = await provider.connection.getBalance(marketPda);
    assert.isAtLeast(balance, 5 * LAMPORTS_PER_SOL);
  });

  it("opens and closes a winning buy position", async () => {
    const alicePos = positionPda(marketPda, alice.publicKey, 0);
    const stake = 1 * LAMPORTS_PER_SOL;
    const entryOddsBps = 27740; // 2.774
    const exitOddsBps = 14350; // 1.435 -- odds fell, buy profits

    await program.methods
      .openPosition(new anchor.BN(0), 0, new anchor.BN(stake), entryOddsBps)
      .accounts({ trader: alice.publicKey, market: marketPda, position: alicePos, systemProgram: SystemProgram.programId })
      .rpc();

    let position = await program.account.position.fetch(alicePos);
    assert.equal(position.tradeId.toNumber(), 0);
    assert.deepEqual(position.status, { open: {} });

    const balanceBefore = await provider.connection.getBalance(alice.publicKey);

    await program.methods
      .closePosition(new anchor.BN(0), exitOddsBps)
      .accounts({ authority: authority.publicKey, market: marketPda, trader: alice.publicKey, position: alicePos })
      .rpc();

    const balanceAfter = await provider.connection.getBalance(alice.publicKey);
    position = await program.account.position.fetch(alicePos);
    assert.deepEqual(position.status, { closed: {} });

    // pnl = stake * (entry - exit) / entry ~= 1 SOL * 0.4827 ~= 0.4827 SOL
    // payout = stake + pnl ~= 1.4827 SOL, all credited back to Alice.
    const gained = balanceAfter - balanceBefore;
    assert.isAbove(gained, 1.4 * LAMPORTS_PER_SOL);
    assert.isBelow(gained, 1.5 * LAMPORTS_PER_SOL);
  });

  it("lets the same trader open a second position in the same market", async () => {
    // This is exactly what the old (market, better) position PDA blocked --
    // trade_id in the seeds is what makes repeated trading possible.
    const alicePos2 = positionPda(marketPda, alice.publicKey, 1);

    await program.methods
      .openPosition(new anchor.BN(1), 1, new anchor.BN(0.5 * LAMPORTS_PER_SOL), 30000)
      .accounts({ trader: alice.publicKey, market: marketPda, position: alicePos2, systemProgram: SystemProgram.programId })
      .rpc();

    const position = await program.account.position.fetch(alicePos2);
    assert.equal(position.tradeId.toNumber(), 1);
    assert.deepEqual(position.side, 1);
  });

  it("clamps a loss to the escrowed stake, never taking more", async () => {
    const bobPos = positionPda(marketPda, bob.publicKey, 2);
    const stake = 1 * LAMPORTS_PER_SOL;
    const entryOddsBps = 1000; // 0.10 (arbitrary small base for this test)
    const exitOddsBps = 6000; // odds moved 6x against a buy position

    await program.methods
      .openPosition(new anchor.BN(2), 0, new anchor.BN(stake), entryOddsBps)
      .accounts({ trader: bob.publicKey, market: marketPda, position: bobPos, systemProgram: SystemProgram.programId })
      .rpc();

    const balanceBefore = await provider.connection.getBalance(bob.publicKey);

    await program.methods
      .closePosition(new anchor.BN(2), exitOddsBps)
      .accounts({ authority: authority.publicKey, market: marketPda, trader: bob.publicKey, position: bobPos })
      .rpc();

    const balanceAfter = await provider.connection.getBalance(bob.publicKey);
    // Raw pnl here is stake * (1000 - 6000) / 1000 = -5x stake, far past
    // -100%. Clamped payout should be exactly 0 -- Bob loses the whole
    // stake and nothing more, and gets nothing back.
    // Allow for small transaction fees
    assert.isBelow(balanceAfter - balanceBefore, 10000);
  });

  it("rejects closing an already-closed position", async () => {
    const bobPos = positionPda(marketPda, bob.publicKey, 2);
    try {
      await program.methods
        .closePosition(new anchor.BN(2), 6000)
        .accounts({ authority: authority.publicKey, market: marketPda, trader: bob.publicKey, position: bobPos })
        .rpc();
      assert.fail("expected PositionNotOpen error");
    } catch (err) {
      assert.include(String(err), "PositionNotOpen");
    }
  });

  it("rejects opening a new position once the market is closed", async () => {
    await program.methods
      .closeMarket()
      .accounts({ authority: authority.publicKey, market: marketPda })
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    assert.deepEqual(market.status, { closed: {} });

    const bobPos2 = positionPda(marketPda, bob.publicKey, 3);
    try {
      await program.methods
        .openPosition(new anchor.BN(3), 0, new anchor.BN(0.1 * LAMPORTS_PER_SOL), 20000)
        .accounts({ trader: bob.publicKey, market: marketPda, position: bobPos2, systemProgram: SystemProgram.programId })
        .rpc();
      assert.fail("expected MarketNotOpen error");
    } catch (err) {
      assert.include(String(err), "MarketNotOpen");
    }
  });

  it("still allows closing a position that was opened before the market closed", async () => {
    // Alice's second position (trade_id=1) was opened before closeMarket
    // above -- close_market only gates new opens, not existing closes.
    const alicePos2 = positionPda(marketPda, alice.publicKey, 1);
    await program.methods
      .closePosition(new anchor.BN(1), 30000)
      .accounts({ authority: authority.publicKey, market: marketPda, trader: alice.publicKey, position: alicePos2 })
      .rpc();

    const position = await program.account.position.fetch(alicePos2);
    assert.deepEqual(position.status, { closed: {} });
  });
});