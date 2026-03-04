import { eq } from "drizzle-orm";
import type { WalletConfig } from "../../domain/types/competitor";
import { decrypt, encrypt } from "../../shared/crypto";
import type { Database } from "../client";
import { competitorWallets } from "../schema";

export function walletsRepo(db: Database) {
  return {
    async findByCompetitorId(
      competitorId: string,
      encryptionKey: string,
    ): Promise<(WalletConfig & { walletAddress: string }) | null> {
      const row = await db
        .select()
        .from(competitorWallets)
        .where(eq(competitorWallets.competitorId, competitorId))
        .get();

      if (!row) return null;

      return {
        walletAddress: row.walletAddress,
        polyPrivateKey: decrypt(row.encryptedPrivateKey, encryptionKey),
        polyApiKey: decrypt(row.encryptedApiKey, encryptionKey),
        polyApiSecret: decrypt(row.encryptedApiSecret, encryptionKey),
        polyApiPassphrase: decrypt(row.encryptedApiPassphrase, encryptionKey),
      };
    },

    async create(
      competitorId: string,
      walletAddress: string,
      walletConfig: WalletConfig,
      encryptionKey: string,
    ) {
      return db
        .insert(competitorWallets)
        .values({
          competitorId,
          walletAddress,
          encryptedPrivateKey: encrypt(walletConfig.polyPrivateKey, encryptionKey),
          encryptedApiKey: encrypt(walletConfig.polyApiKey, encryptionKey),
          encryptedApiSecret: encrypt(walletConfig.polyApiSecret, encryptionKey),
          encryptedApiPassphrase: encrypt(walletConfig.polyApiPassphrase, encryptionKey),
        })
        .run();
    },

    async delete(competitorId: string) {
      return db
        .delete(competitorWallets)
        .where(eq(competitorWallets.competitorId, competitorId))
        .run();
    },

    async listAll() {
      return db
        .select({
          competitorId: competitorWallets.competitorId,
          walletAddress: competitorWallets.walletAddress,
          createdAt: competitorWallets.createdAt,
        })
        .from(competitorWallets)
        .all();
    },
  };
}

export type WalletsRepo = ReturnType<typeof walletsRepo>;
