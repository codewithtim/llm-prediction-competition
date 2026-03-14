/**
 * Verify wallet decryption against the database.
 *
 * Attempts to decrypt every wallet row using the current WALLET_ENCRYPTION_KEY
 * and reports success or failure for each competitor.
 *
 * Usage:
 *   bun run src/scripts/verify-wallets.ts
 */

import { createDb } from "../database/client.ts";
import { walletsRepo } from "../database/repositories/wallets.ts";
import { env } from "../shared/env.ts";

async function verifyWallets() {
  if (!env.WALLET_ENCRYPTION_KEY) {
    console.error("WALLET_ENCRYPTION_KEY is required.");
    process.exit(1);
  }

  const db = createDb(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
  const wallets = walletsRepo(db);

  const allWallets = await wallets.listAll();

  if (allWallets.length === 0) {
    console.log("No wallets found in database.");
    return;
  }

  console.log(`Found ${allWallets.length} wallet(s). Verifying decryption...\n`);

  let ok = 0;
  let failed = 0;

  for (const row of allWallets) {
    try {
      const decrypted = await wallets.findByCompetitorId(
        row.competitorId,
        env.WALLET_ENCRYPTION_KEY,
      );
      if (decrypted) {
        const keyPreview = `${decrypted.polyApiKey.slice(0, 8)}...`;
        console.log(`  ✓ ${row.competitorId} — ${row.walletAddress} (apiKey: ${keyPreview})`);
        ok++;
      } else {
        console.log(`  ✗ ${row.competitorId} — row disappeared during read`);
        failed++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ${row.competitorId} — decryption failed: ${message}`);
      failed++;
    }
  }

  console.log(`\nResults: ${ok} ok, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

await verifyWallets();
