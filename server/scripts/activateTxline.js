#!/usr/bin/env node
/**
 * scripts/activateTxline.js
 *
 * One-time (well, once-per-subscription-period) setup script that runs the
 * full TxLINE credential flow described in the TxLINE quickstart
 * (https://txline-docs.txodds.com/documentation/quickstart) and the World
 * Cup free-tier guide, then writes the resulting static credentials into
 * `.env` so the running server can just read them.
 *
 * What it does, in order:
 *   1. Loads (or generates) a local Solana keypair to use as the wallet.
 *   2. On devnet, airdrops SOL into that wallet if the balance is low
 *      (needed for tx fees / rent - the free tier does NOT need TxL).
 *   3. Submits an on-chain `subscribe` transaction to the TxLINE Solana
 *      program for the chosen service level (1 = 60s delay, free tier;
 *      devnet only exposes level 1).
 *   4. Requests a guest JWT from TxLINE's auth endpoint.
 *   5. Signs `${txSig}::${jwt}` with the same wallet and activates the
 *      subscription to get a real API token.
 *   6. Writes TXLINE_API_ORIGIN / TXLINE_NETWORK / TXLINE_WALLET_KEYPAIR_PATH
 *      into .env. The API token itself is intentionally NOT frozen into
 *      .env because it's tied to the guest JWT lifecycle - src/lib/txline.js
 *      re-activates automatically using the saved wallet + on-chain
 *      subscription record when the cached token/JWT expire. (If you'd
 *      rather freeze a token, --print-token dumps it to stdout.)
 *
 * Usage:
 *   node scripts/activateTxline.js [--network devnet|mainnet] [--service-level 1] [--print-token]
 *
 * Requirements (added to package.json):
 *   @coral-xyz/anchor, @solana/web3.js, @solana/spl-token, tweetnacl, axios, dotenv
 *
 * IMPORTANT - IDL requirement:
 *   This script needs the TxLINE ("txoracle") Anchor IDL to build the
 *   `subscribe` instruction. It first tries to fetch the IDL directly from
 *   chain (`anchor.Program.fetchIdl`), which works if TxODDS published it
 *   on-chain for this program id. If that fails, download the matching
 *   devnet/mainnet IDL JSON from TxODDS's tx-on-chain repo
 *   (https://github.com/txodds/tx-on-chain) or the "Runnable Devnet
 *   Examples" page in the docs, and save it as:
 *     idl/txoracle.devnet.json   (or txoracle.mainnet.json)
 *   This script will pick it up automatically if present.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import nacl from 'tweetnacl';
import * as anchor from '@coral-xyz/anchor';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

// ---------------------------------------------------------------------------
// CLI args / config
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    network: process.env.TXLINE_NETWORK || 'devnet',
    serviceLevel: null,
    durationWeeks: 4,
    printToken: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--network') out.network = args[++i];
    else if (a === '--service-level') out.serviceLevel = Number(args[++i]);
    else if (a === '--duration-weeks') out.durationWeeks = Number(args[++i]);
    else if (a === '--print-token') out.printToken = true;
  }
  return out;
}

const NETWORK_CONFIG = {
  mainnet: {
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    apiOrigin: 'https://txline.txodds.com',
    programId: new PublicKey('9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA'),
    txlTokenMint: new PublicKey('Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL'),
    // Free tier on mainnet exposes both 1 (60s delay) and 12 (real-time).
    defaultServiceLevel: 1,
  },
  devnet: {
    rpcUrl: 'https://api.devnet.solana.com',
    apiOrigin: 'https://txline-dev.txodds.com',
    programId: new PublicKey('6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J'),
    txlTokenMint: new PublicKey('4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG'),
    // Devnet only exposes service level 1.
    defaultServiceLevel: 1,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(...msg) {
  console.log('[activateTxline]', ...msg);
}

function loadOrCreateKeypair(network) {
  const keypairPath = path.join(ROOT, `txline-${network}-keypair.json`);
  if (fs.existsSync(keypairPath)) {
    const secret = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
    log(`Loaded existing wallet from ${keypairPath}`);
    return { keypair: Keypair.fromSecretKey(Uint8Array.from(secret)), keypairPath };
  }
  const keypair = Keypair.generate();
  fs.writeFileSync(keypairPath, JSON.stringify(Array.from(keypair.secretKey)));
  log(`Generated new wallet, saved to ${keypairPath}`);
  log(`Wallet public key: ${keypair.publicKey.toBase58()}`);
  return { keypair, keypairPath };
}

async function ensureFunded(connection, publicKey, network) {
  const balance = await connection.getBalance(publicKey);
  log(`Wallet balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  if (balance > 0.02 * LAMPORTS_PER_SOL) return;

  if (network !== 'devnet') {
    throw new Error(
      `Wallet ${publicKey.toBase58()} needs SOL on ${network} to pay tx fees. ` +
        `Fund it manually - mainnet airdrops don't exist.` 
    );
  }

  const walletAddress = publicKey.toBase58();
  log('Balance too low, requesting devnet airdrop...');
  
  // Try multiple faucets
  const faucets = [
    {
      name: 'QuickNode',
      url: 'https://faucet.quicknode.com/solana/devnet',
      method: 'get',
      params: { address: walletAddress }
    },
    {
      name: 'Solana Web',
      url: 'https://faucet.solana.com/sol',
      method: 'post',
      params: { wallet: walletAddress, amount: 1, network: 'devnet' }
    }
  ];

  for (const faucet of faucets) {
    try {
      log(`Trying ${faucet.name} faucet...`);
      let response;
      if (faucet.method === 'get') {
        response = await axios.get(faucet.url, { params: faucet.params });
      } else {
        response = await axios.post(faucet.url, faucet.params);
      }
      log(`${faucet.name} response: ${JSON.stringify(response.data)}`);
      
      // Wait for airdrop to process
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Verify balance
      const newBalance = await connection.getBalance(publicKey);
      log(`New wallet balance: ${newBalance / LAMPORTS_PER_SOL} SOL`);
      
      if (newBalance > balance) {
        log(`Successfully funded via ${faucet.name}`);
        return;
      }
    } catch (faucetError) {
      log(`${faucet.name} faucet failed: ${faucetError.message}`);
    }
  }

  // All faucets failed, provide manual instructions
  throw new Error(
    `All automatic faucets failed. Please manually fund the wallet:\n` +
    `Wallet address: ${walletAddress}\n` +
    `Visit one of these faucets:\n` +
    `  - https://faucet.solana.com\n` +
    `  - https://www.quicknode.com/chains/sol/faucet\n` +
    `After funding, re-run this script.`
  );
}

async function ensureTokenAccountExists(connection, userTokenAccount, ownerKeypair, mint) {
  const accountInfo = await connection.getAccountInfo(userTokenAccount);
  if (accountInfo) {
    log('Token account already exists');
    return;
  }

  log('Creating token account...');
  const createTx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      ownerKeypair.publicKey,
      userTokenAccount,
      ownerKeypair.publicKey,
      mint,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  );
  
  const { blockhash } = await connection.getLatestBlockhash();
  createTx.recentBlockhash = blockhash;
  createTx.feePayer = ownerKeypair.publicKey;
  
  const sig = await connection.sendTransaction(createTx, [ownerKeypair]);
  await connection.confirmTransaction(sig, 'confirmed');
  log(`Token account created: ${sig}`);
}

async function loadIdl(programId, provider, network) {
  const localIdlPath = path.join(ROOT, 'idl', `txoracle.${network}.json`);
  if (fs.existsSync(localIdlPath)) {
    log(`Using local IDL file at ${localIdlPath}`);
    return JSON.parse(fs.readFileSync(localIdlPath, 'utf8'));
  }

  log('No local IDL file found, trying to fetch IDL from chain...');
  const idl = await anchor.Program.fetchIdl(programId, provider);
  if (!idl) {
    throw new Error(
      `Could not find an on-chain IDL for program ${programId.toBase58()} and no local ` +
        `idl/txoracle.${network}.json was found.\n` +
        `Download the matching IDL from https://github.com/txodds/tx-on-chain ` +
        `(or the "Runnable Devnet Examples" page in the TxLINE docs) and save it as ` +
        `idl/txoracle.${network}.json, then re-run this script.` 
    );
  }
  log('Fetched IDL from chain.');
  return idl;
}

function updateEnvFile(updates) {
  let contents = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(contents)) {
      contents = contents.replace(re, line);
    } else {
      contents += (contents.endsWith('\n') || contents === '' ? '' : '\n') + line + '\n';
    }
  }
  fs.writeFileSync(ENV_PATH, contents);
  log(`Updated ${ENV_PATH}`);
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

async function main() {
  const { network, durationWeeks, printToken } = parseArgs();
  const cfg = NETWORK_CONFIG[network];
  if (!cfg) {
    throw new Error(`Unknown network "${network}". Use "devnet" or "mainnet".`);
  }
  const serviceLevel = parseArgs().serviceLevel ?? cfg.defaultServiceLevel;
  const selectedLeagues = []; // Standard/free bundle - empty array.

  log(`Network: ${network}`);
  log(`Service level: ${serviceLevel}, duration: ${durationWeeks} week(s)`);

  // 1. Wallet
  const { keypair, keypairPath } = loadOrCreateKeypair(network);
  const wallet = new anchor.Wallet(keypair);

  // 2. Connection + provider
  const connection = new Connection(cfg.rpcUrl, 'confirmed');
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);

  // 3. Make sure the wallet can pay tx fees / rent.
  await ensureFunded(connection, keypair.publicKey, network);

  // 4. Load the Anchor program (IDL from chain or local file).
  const idl = await loadIdl(cfg.programId, provider, network);
  const program = new anchor.Program(idl, provider);
  if (!program.programId.equals(cfg.programId)) {
    throw new Error(
      `Loaded IDL program ${program.programId.toBase58()} does not match ${network} program ${cfg.programId.toBase58()}` 
    );
  }

  // 5. Derive shared accounts.
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_treasury_v2')],
    program.programId
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    cfg.txlTokenMint,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pricing_matrix')],
    program.programId
  );
  const userTokenAccount = getAssociatedTokenAddressSync(
    cfg.txlTokenMint,
    provider.wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  // 5.5. Ensure token account exists
  await ensureTokenAccountExists(connection, userTokenAccount, keypair, cfg.txlTokenMint);

  // 6. Submit the on-chain subscribe transaction (free tier: no TxL needed,
  //    just the SOL tx fee already ensured above).
  log('Submitting on-chain subscribe transaction...');
  const txSig = await program.methods
    .subscribe(serviceLevel, durationWeeks)
    .accounts({
      user: provider.wallet.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: cfg.txlTokenMint,
      userTokenAccount,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  log(`Subscribed on-chain: ${txSig}`);

  // 7. Guest JWT.
  log('Requesting guest JWT...');
  const authResponse = await axios.post(`${cfg.apiOrigin}/auth/guest/start`);
  const jwt = authResponse.data.token;

  // 8. Sign the activation message with the same wallet that subscribed.
  const messageString = `${txSig}:${selectedLeagues.join(',')}:${jwt}`;
  const message = new TextEncoder().encode(messageString);
  const signatureBytes = nacl.sign.detached(message, keypair.secretKey);
  const walletSignature = Buffer.from(signatureBytes).toString('base64');

  // 9. Activate API access.
  log('Activating API token...');
  const activationResponse = await axios.post(
    `${cfg.apiOrigin}/api/token/activate`,
    { txSig, walletSignature, leagues: selectedLeagues },
    { headers: { Authorization: `Bearer ${jwt}` } }
  );
  const apiToken = activationResponse.data.token || activationResponse.data;

  log('Activation complete.');

  // 10. Persist the durable bits into .env. The JWT is short-lived and the
  //     token is re-derivable from the on-chain subscription, so the
  //     server re-activates at runtime (see src/lib/txline.js) using the
  //     saved wallet keypair rather than relying on a frozen token/JWT pair.
  updateEnvFile({
    TXLINE_NETWORK: network,
    TXLINE_API_ORIGIN: cfg.apiOrigin,
    TXLINE_WALLET_KEYPAIR_PATH: keypairPath,
    TXLINE_SUBSCRIBE_TX_SIG: txSig,
  });

  if (printToken) {
    log('--print-token was set, current credentials:');
    console.log(JSON.stringify({ jwt, apiToken }, null, 2));
  }

  log('Done! Your server can now read TXLINE_API_ORIGIN / TXLINE_WALLET_KEYPAIR_PATH from .env.');
}

main().catch((err) => {
  console.error('[activateTxline] Failed:', err.response?.data || err.message || err);
  process.exit(1);
});
