/**
 * Import wallets from disk into the database.
 *
 * Reads plaintext wallet JSON files from data/wallets/ and stores them
 * encrypted in the competitor_wallets table. Skips files whose wallet
 * already exists in the DB.
 *
 * Usage:
 *   bun run wallets:import
 *
 * Requires:
 *   WALLET_ENCRYPTION_KEY — encryption key for wallet credentials
 *   TURSO_DATABASE_URL    — database connection
 */

import { readdirSync, readFileSync } from "node:fs";
import { createDb } from "../infrastructure/database/client.ts";
import { competitorsRepo } from "../infrastructure/database/repositories/competitors.ts";
import { walletsRepo } from "../infrastructure/database/repositories/wallets.ts";
import { env } from "../shared/env.ts";

const WALLETS_DIR = "data/wallets";

async function importWallets() {
  if (!env.WALLET_ENCRYPTION_KEY) {
    console.error("WALLET_ENCRYPTION_KEY is required to import wallets.");
    process.exit(1);
  }

  const db = createDb(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
  const comps = competitorsRepo(db);
  const wallets = walletsRepo(db);

  const files = readdirSync(WALLETS_DIR).filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    console.log(`No wallet files found in ${WALLETS_DIR}/`);
    return;
  }

  console.log(`Found ${files.length} wallet file(s) in ${WALLETS_DIR}/\n`);

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    const competitorId = file.replace(/\.json$/, "");
    const filePath = `${WALLETS_DIR}/${file}`;

    try {
      const raw = readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw) as {
        competitorId: string;
        walletAddress: string;
        privateKey: string;
        apiKey: string;
        apiSecret: string;
        apiPassphrase: string;
      };

      // Verify competitor exists
      const competitor = await comps.findById(competitorId);
      if (!competitor) {
        console.log(`  ${file} — error: competitor "${competitorId}" not found in DB`);
        errors++;
        continue;
      }

      // Skip if wallet already exists
      const existing = await wallets.findByCompetitorId(competitorId, env.WALLET_ENCRYPTION_KEY);
      if (existing) {
        console.log(`  ${file} — skipped (wallet already exists)`);
        skipped++;
        continue;
      }

      // Import: map JSON fields to WalletConfig and store encrypted
      await wallets.create(
        competitorId,
        data.walletAddress,
        {
          polyPrivateKey: data.privateKey,
          polyApiKey: data.apiKey,
          polyApiSecret: data.apiSecret,
          polyApiPassphrase: data.apiPassphrase,
        },
        env.WALLET_ENCRYPTION_KEY,
      );

      console.log(`  ${file} — imported (${data.walletAddress})`);
      imported++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ${file} — error: ${message}`);
      errors++;
    }
  }

  console.log(`\nDone. Imported ${imported}, skipped ${skipped}, errors ${errors}.`);
}

await importWallets();
