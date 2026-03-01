import { sql } from "drizzle-orm";
import { loadCompetitors } from "./competitors/loader.ts";
import { createRegistry } from "./competitors/registry.ts";
import { createBettingService } from "./domain/services/betting.ts";
import { createSettlementService } from "./domain/services/settlement.ts";
import { createDb } from "./infrastructure/database/client.ts";
import { betsRepo } from "./infrastructure/database/repositories/bets.ts";
import { competitorVersionsRepo } from "./infrastructure/database/repositories/competitor-versions.ts";
import { competitorsRepo } from "./infrastructure/database/repositories/competitors.ts";
import { fixturesRepo } from "./infrastructure/database/repositories/fixtures.ts";
import { marketsRepo } from "./infrastructure/database/repositories/markets.ts";
import { predictionsRepo } from "./infrastructure/database/repositories/predictions.ts";
import { walletsRepo } from "./infrastructure/database/repositories/wallets.ts";
import { createOpenRouterClient } from "./infrastructure/openrouter/client.ts";
import { createBettingClientFactory } from "./infrastructure/polymarket/betting-client-factory.ts";
import { createGammaClient } from "./infrastructure/polymarket/gamma-client.ts";
import { createMarketDiscovery } from "./infrastructure/polymarket/market-discovery.ts";
import { createFootballClient } from "./infrastructure/sports-data/client.ts";
import { DEFAULT_CONFIG } from "./orchestrator/config.ts";
import { createDiscoveryPipeline } from "./orchestrator/discovery-pipeline.ts";
import { createPredictionPipeline } from "./orchestrator/prediction-pipeline.ts";
import { createScheduler } from "./orchestrator/scheduler.ts";
import { env } from "./shared/env.ts";
import { logger } from "./shared/logger.ts";

// ── Database ─────────────────────────────────────────────────────────
const db = createDb(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);

try {
  await db.get(sql`SELECT 1+1 AS result`);
  logger.info("Database connection verified");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error("Database connection failed — shutting down", { error: msg });
  process.exit(1);
}

const markets = marketsRepo(db);
const fixtures = fixturesRepo(db);
const preds = predictionsRepo(db);
const bets = betsRepo(db);
const comps = competitorsRepo(db);
const wallets = walletsRepo(db);
const versions = competitorVersionsRepo(db);

// ── External clients ─────────────────────────────────────────────────
const gammaClient = createGammaClient();
const footballClient = createFootballClient(env.API_SPORTS_KEY);
const openrouterConfigured = !!env.OPENROUTER_API_KEY;
const openrouter = openrouterConfigured ? createOpenRouterClient(env.OPENROUTER_API_KEY) : null;
const bettingClientFactory = createBettingClientFactory();

if (!openrouterConfigured) {
  logger.info("OpenRouter not configured — runtime competitors will be skipped");
}

// ── Services ─────────────────────────────────────────────────────────
const discovery = createMarketDiscovery(gammaClient, {
  leagues: DEFAULT_CONFIG.leagues,
  lookAheadDays: DEFAULT_CONFIG.fixtureLookAheadDays,
});
const bettingService = createBettingService({
  bettingClientFactory,
  betsRepo: bets,
  config: DEFAULT_CONFIG.betting,
});
const settlementService = createSettlementService({
  gammaClient,
  betsRepo: bets,
  marketsRepo: markets,
});

// ── Competitor registry (database-driven) ────────────────────────────
const engines = await loadCompetitors({
  competitorsRepo: comps,
  walletsRepo: wallets,
  encryptionKey: env.WALLET_ENCRYPTION_KEY,
  versionsRepo: versions,
});

const registry = createRegistry();
for (const entry of engines) {
  registry.register(entry.competitorId, entry.name, entry.engine, entry.walletConfig);
}

// ── Pipelines & scheduler ────────────────────────────────────────────
const discoveryPipeline = createDiscoveryPipeline({
  discovery,
  footballClient,
  marketsRepo: markets,
  fixturesRepo: fixtures,
  config: DEFAULT_CONFIG,
});

const predictionPipeline = createPredictionPipeline({
  gammaClient,
  footballClient,
  registry,
  bettingService,
  marketsRepo: markets,
  fixturesRepo: fixtures,
  predictionsRepo: preds,
  config: DEFAULT_CONFIG,
});

const scheduler = createScheduler({
  discoveryPipeline,
  predictionPipeline,
  settlementService,
  config: DEFAULT_CONFIG,
});

// ── HTTP server ──────────────────────────────────────────────────────
const server = Bun.serve({
  port: env.PORT,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
});

logger.info("Server running", { port: server.port });

// ── Start scheduler ──────────────────────────────────────────────────
scheduler.start();

// ── Graceful shutdown ────────────────────────────────────────────────
process.on("SIGINT", () => {
  logger.info("Shutting down");
  scheduler.stop();
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("Shutting down");
  scheduler.stop();
  server.stop();
  process.exit(0);
});
