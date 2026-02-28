/**
 * Wallet Management CLI — create, list, export, and remove competitor wallets.
 *
 * Usage:
 *   bun run wallets:create <competitor-id>   — generate wallet + Polymarket API keys, store encrypted in DB
 *   bun run wallets:list                     — list all competitors with wallet addresses
 *   bun run wallets:export <competitor-id>   — decrypt and write credentials to data/wallets/<id>.json
 *   bun run wallets:remove <competitor-id>   — remove wallet from DB
 *
 * Requires:
 *   WALLET_ENCRYPTION_KEY — encryption key for wallet credentials
 *   TURSO_DATABASE_URL    — database connection
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { Wallet } from "@ethersproject/wallet";
import { ClobClient } from "@polymarket/clob-client";
import { createDb } from "../infrastructure/database/client.ts";
import { competitorsRepo } from "../infrastructure/database/repositories/competitors.ts";
import { walletsRepo } from "../infrastructure/database/repositories/wallets.ts";
import { env } from "../shared/env.ts";

const CLOB_BASE_URL = "https://clob.polymarket.com";
const POLYGON_CHAIN_ID = 137;
const SIGNATURE_TYPE_EOA = 0;
const WALLETS_DIR = "data/wallets";

function ensureWalletsDir() {
  if (!existsSync(WALLETS_DIR)) {
    mkdirSync(WALLETS_DIR, { recursive: true });
  }
}

function writeCredentialsFile(
  competitorId: string,
  data: {
    walletAddress: string;
    privateKey: string;
    apiKey: string;
    apiSecret: string;
    apiPassphrase: string;
  },
) {
  ensureWalletsDir();
  const filePath = `${WALLETS_DIR}/${competitorId}.json`;
  writeFileSync(
    filePath,
    JSON.stringify(
      {
        competitorId,
        ...data,
      },
      null,
      2,
    ),
  );
  return filePath;
}

async function createWallet(competitorId: string) {
  if (!env.WALLET_ENCRYPTION_KEY) {
    console.error("WALLET_ENCRYPTION_KEY is required to create wallets.");
    process.exit(1);
  }

  const db = createDb(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
  const comps = competitorsRepo(db);
  const wallets = walletsRepo(db);

  // Verify competitor exists
  const competitor = await comps.findById(competitorId);
  if (!competitor) {
    console.error(`Competitor "${competitorId}" not found in database.`);
    process.exit(1);
  }

  // Check if wallet already exists
  const existing = await wallets.findByCompetitorId(competitorId, env.WALLET_ENCRYPTION_KEY);
  if (existing) {
    console.error(`Wallet already exists for "${competitorId}" (address: ${existing.walletAddress}).`);
    console.error("Use 'wallets:remove' first if you want to replace it.");
    process.exit(1);
  }

  // Generate Polygon wallet
  console.log("Generating Polygon wallet...");
  const wallet = Wallet.createRandom();
  const privateKey = wallet.privateKey;
  const walletAddress = wallet.address;
  console.log(`  Address: ${walletAddress}`);

  // Register with Polymarket to get API credentials
  console.log("Registering with Polymarket CLOB...");
  const clob = new ClobClient(CLOB_BASE_URL, POLYGON_CHAIN_ID, wallet, undefined, SIGNATURE_TYPE_EOA);

  let apiKey: string;
  let apiSecret: string;
  let apiPassphrase: string;

  try {
    const apiCreds = await clob.createApiKey();
    apiKey = apiCreds.key;
    apiSecret = apiCreds.secret;
    apiPassphrase = apiCreds.passphrase;
    console.log("  Polymarket API keys created successfully.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to create Polymarket API keys: ${message}`);
    process.exit(1);
  }

  // Store encrypted in DB
  console.log("Storing encrypted credentials in database...");
  await wallets.create(
    competitorId,
    walletAddress,
    {
      polyPrivateKey: privateKey,
      polyApiKey: apiKey,
      polyApiSecret: apiSecret,
      polyApiPassphrase: apiPassphrase,
    },
    env.WALLET_ENCRYPTION_KEY,
  );

  // Write credentials file
  const filePath = writeCredentialsFile(competitorId, {
    walletAddress,
    privateKey,
    apiKey,
    apiSecret,
    apiPassphrase,
  });

  console.log(`\nWallet created for "${competitorId}".`);
  console.log(`Credentials written to: ${filePath}`);
  console.log("\nIMPORTANT: Copy credentials to your password manager, then delete the file.");
  console.log(`Next step: Fund ${walletAddress} with USDC on Polygon.`);
}

async function listWallets() {
  const db = createDb(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
  const wallets = walletsRepo(db);
  const comps = competitorsRepo(db);

  const allWallets = await wallets.listAll();
  const allCompetitors = await comps.findByStatus("active");

  if (allCompetitors.length === 0) {
    console.log("No active competitors found.");
    return;
  }

  console.log("Competitor Wallets:\n");
  console.log("  ID                   | Wallet Address                             | Status");
  console.log("  " + "-".repeat(85));

  for (const comp of allCompetitors) {
    const wallet = allWallets.find((w) => w.competitorId === comp.id);
    const address = wallet ? wallet.walletAddress : "(no wallet)";
    const status = wallet ? "configured" : "missing";
    console.log(`  ${comp.id.padEnd(20)} | ${address.padEnd(42)} | ${status}`);
  }
}

async function exportWallet(competitorId: string) {
  if (!env.WALLET_ENCRYPTION_KEY) {
    console.error("WALLET_ENCRYPTION_KEY is required to export wallets.");
    process.exit(1);
  }

  const db = createDb(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
  const wallets = walletsRepo(db);

  const wallet = await wallets.findByCompetitorId(competitorId, env.WALLET_ENCRYPTION_KEY);
  if (!wallet) {
    console.error(`No wallet found for "${competitorId}".`);
    process.exit(1);
  }

  const filePath = writeCredentialsFile(competitorId, {
    walletAddress: wallet.walletAddress,
    privateKey: wallet.polyPrivateKey,
    apiKey: wallet.polyApiKey,
    apiSecret: wallet.polyApiSecret,
    apiPassphrase: wallet.polyApiPassphrase,
  });

  console.log(`Credentials exported to: ${filePath}`);
  console.log("IMPORTANT: Copy credentials to your password manager, then delete the file.");
}

async function removeWallet(competitorId: string) {
  const db = createDb(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
  const wallets = walletsRepo(db);

  const allWallets = await wallets.listAll();
  const exists = allWallets.find((w) => w.competitorId === competitorId);

  if (!exists) {
    console.error(`No wallet found for "${competitorId}".`);
    process.exit(1);
  }

  await wallets.delete(competitorId);
  console.log(`Wallet removed for "${competitorId}".`);
  console.log("Note: On-chain funds at the wallet address are unaffected.");
}

// ── CLI routing ──────────────────────────────────────────────────────
const [command, competitorId] = process.argv.slice(2);

switch (command) {
  case "create":
    if (!competitorId) {
      console.error("Usage: bun run wallets:create <competitor-id>");
      process.exit(1);
    }
    await createWallet(competitorId);
    break;

  case "list":
    await listWallets();
    break;

  case "export":
    if (!competitorId) {
      console.error("Usage: bun run wallets:export <competitor-id>");
      process.exit(1);
    }
    await exportWallet(competitorId);
    break;

  case "remove":
    if (!competitorId) {
      console.error("Usage: bun run wallets:remove <competitor-id>");
      process.exit(1);
    }
    await removeWallet(competitorId);
    break;

  default:
    console.log("Wallet Management CLI\n");
    console.log("Commands:");
    console.log("  create <competitor-id>  — Generate wallet + Polymarket API keys");
    console.log("  list                    — List all competitors and wallet addresses");
    console.log("  export <competitor-id>  — Export decrypted credentials to file");
    console.log("  remove <competitor-id>  — Remove wallet from database");
    console.log("\nExamples:");
    console.log("  bun run wallets:create baseline");
    console.log("  bun run wallets:list");
    process.exit(command ? 1 : 0);
}
