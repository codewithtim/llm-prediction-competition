import type { BettingEventsRepo } from "../database/repositories/betting-events";
import type { competitorVersionsRepo } from "../database/repositories/competitor-versions";
import type { CompetitorsRepo } from "../database/repositories/competitors";
import type { WalletsRepo } from "../database/repositories/wallets";
import type { RegisteredEngine } from "../engine/types";
import { logger } from "../shared/logger";
import { createWeightedEngine } from "./weight-tuned/engine";
import { DEFAULT_STAKE_CONFIG, DEFAULT_WEIGHTS, weightConfigSchema } from "./weight-tuned/types";

export type LoaderDeps = {
  competitorsRepo: CompetitorsRepo;
  walletsRepo: WalletsRepo;
  encryptionKey: string;
  versionsRepo?: ReturnType<typeof competitorVersionsRepo>;
  bettingEventsRepo?: BettingEventsRepo;
};

export async function loadCompetitors(deps: LoaderDeps): Promise<RegisteredEngine[]> {
  const { competitorsRepo, walletsRepo, encryptionKey, versionsRepo, bettingEventsRepo } = deps;
  const rows = await competitorsRepo.findByStatus("active");
  const engines: RegisteredEngine[] = [];
  let walletsLoaded = 0;
  let walletsNotFound = 0;
  let walletsFailed = 0;

  for (const row of rows) {
    try {
      const engine = await loadSingleCompetitor(row, versionsRepo);
      if (engine) {
        const registered: RegisteredEngine = { competitorId: row.id, name: row.name, engine };

        if (encryptionKey) {
          try {
            const wallet = await walletsRepo.findByCompetitorId(row.id, encryptionKey);
            if (wallet) {
              registered.walletConfig = {
                polyPrivateKey: wallet.polyPrivateKey,
                polyApiKey: wallet.polyApiKey,
                polyApiSecret: wallet.polyApiSecret,
                polyApiPassphrase: wallet.polyApiPassphrase,
              };
              walletsLoaded++;
              logger.info("Loaded wallet for competitor", { id: row.id });
            } else {
              walletsNotFound++;
              logger.warn(
                "No wallet row found for competitor (encryption key is set but no wallet exists in DB)",
                { id: row.id },
              );
              await bettingEventsRepo?.safeRecord({
                competitorId: row.id,
                event: "wallet_not_found",
                reason: "No wallet row in DB despite encryption key being configured",
              });
            }
          } catch (err) {
            walletsFailed++;
            const message = err instanceof Error ? err.message : String(err);
            const errorType = err instanceof Error ? err.constructor.name : "Unknown";
            logger.error(
              "Failed to load wallet for competitor — possible key mismatch or corrupt data",
              {
                id: row.id,
                errorType,
                error: message,
              },
            );
            await bettingEventsRepo?.safeRecord({
              competitorId: row.id,
              event: "wallet_load_failed",
              reason: `Decryption failed: ${errorType}`,
              metadata: { error: message },
            });
          }
        }

        engines.push(registered);
        logger.info("Loaded competitor", { id: row.id, type: row.type });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Failed to load competitor", { id: row.id, error: message });
      await competitorsRepo.setStatus(row.id, "error");
    }
  }

  logger.info("Competitor loading complete", {
    loaded: engines.length,
    total: rows.length,
    walletsLoaded,
    walletsNotFound,
    walletsFailed,
  });
  return engines;
}

async function loadSingleCompetitor(
  row: { id: string; type: string; config: string | null; enginePath: string | null },
  versionsRepo?: ReturnType<typeof competitorVersionsRepo>,
) {
  switch (row.type) {
    case "weight-tuned": {
      let weights = DEFAULT_WEIGHTS;
      if (versionsRepo) {
        const latest = await versionsRepo.findLatest(row.id);
        if (latest?.code) {
          try {
            const parsed = weightConfigSchema.safeParse(JSON.parse(latest.code));
            if (parsed.success) weights = parsed.data;
          } catch {
            logger.info("Using default weights for competitor (parse failed)", { id: row.id });
          }
        }
      }
      return createWeightedEngine(weights, DEFAULT_STAKE_CONFIG);
    }

    case "external": {
      logger.info("Skipping external competitor (not yet implemented)", { id: row.id });
      return null;
    }

    default:
      throw new Error(`Unknown competitor type: ${row.type}`);
  }
}
