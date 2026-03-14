import { sql } from "drizzle-orm";
import { serveStatic } from "hono/bun";
import { createApi } from "./api/index.ts";
import { defaultAdapterFactories } from "./apis/notifications/adapter-registry.ts";
import { createOpenRouterClient } from "./apis/openrouter/client.ts";
import { createBettingClientFactory } from "./apis/polymarket/betting-client-factory.ts";
import { createGammaClient } from "./apis/polymarket/gamma-client.ts";
import { createMarketDiscovery } from "./apis/polymarket/market-discovery.ts";
import { createFootballClient } from "./apis/sports-data/client.ts";
import { loadCompetitors } from "./competitors/loader.ts";
import { createRegistry } from "./competitors/registry.ts";
import { createDb } from "./database/client.ts";
import { auditLogRepo } from "./database/repositories/audit-log.ts";
import { betsRepo } from "./database/repositories/bets.ts";
import { bettingEventsRepo } from "./database/repositories/betting-events.ts";
import { competitorVersionsRepo } from "./database/repositories/competitor-versions.ts";
import { competitorsRepo } from "./database/repositories/competitors.ts";
import { fixturesRepo } from "./database/repositories/fixtures.ts";
import { leaguesRepo } from "./database/repositories/leagues.ts";
import { marketsRepo } from "./database/repositories/markets.ts";
import { notificationChannelsRepo } from "./database/repositories/notification-channels.ts";
import { predictionsRepo } from "./database/repositories/predictions.ts";
import { sportsRepo } from "./database/repositories/sports.ts";
import { statsCacheRepo } from "./database/repositories/stats-cache.ts";
import { walletsRepo } from "./database/repositories/wallets.ts";
import { createBankrollProvider } from "./domain/services/bankroll.ts";
import { createBetRetryService } from "./domain/services/bet-retry.ts";
import { createBettingService } from "./domain/services/betting.ts";
import { createNotificationService } from "./domain/services/notification.ts";
import { createOrderConfirmationService } from "./domain/services/order-confirmation.ts";
import { createSettlementService } from "./domain/services/settlement.ts";
import { DEFAULT_CONFIG } from "./orchestrator/config.ts";
import { createDiscoveryPipeline } from "./orchestrator/discovery-pipeline.ts";
import { createFixtureStatusPipeline } from "./orchestrator/fixture-status-pipeline.ts";
import { createMarketRefreshPipeline } from "./orchestrator/market-refresh-pipeline.ts";
import { createPredictionPipeline } from "./orchestrator/prediction-pipeline.ts";
import { createRedemptionPipeline } from "./orchestrator/redemption-pipeline.ts";
import { createScheduler } from "./orchestrator/scheduler.ts";
import { createSummaryPipeline } from "./orchestrator/summary-pipeline.ts";
import { env } from "./shared/env.ts";
import { logger } from "./shared/logger.ts";
import { configureAxiosProxy, createProxyFetch } from "./shared/proxy.ts";

// ── Proxy setup (must run before any Polymarket client creation) ─────
if (env.PROXY_URL) {
  configureAxiosProxy(env.PROXY_URL);
  logger.info("Polymarket proxy configured", {
    proxy: env.PROXY_URL.replace(/\/\/.*@/, "//<redacted>@"),
  });
}

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
const statsCache = statsCacheRepo(db);
const auditLog = auditLogRepo(db);
const bettingEvents = bettingEventsRepo(db);
const bets = betsRepo(db);
const comps = competitorsRepo(db);
const wallets = walletsRepo(db);
const versions = competitorVersionsRepo(db);
const sportsRepository = sportsRepo(db);
const leaguesRepository = leaguesRepo(db);

// ── External clients ─────────────────────────────────────────────────
const polyFetch = env.PROXY_URL ? createProxyFetch(env.PROXY_URL) : fetch;
const gammaClient = createGammaClient(polyFetch);
const footballClient = createFootballClient(env.API_SPORTS_KEY);
const openrouterConfigured = !!env.OPENROUTER_API_KEY;
const _openrouter = openrouterConfigured ? createOpenRouterClient(env.OPENROUTER_API_KEY) : null;
const bettingClientFactory = createBettingClientFactory();

if (!openrouterConfigured) {
  logger.info("OpenRouter not configured — runtime competitors will be skipped");
}

// ── Sports & leagues from DB ──────────────────────────────────────────
const enabledSports = await sportsRepository.findEnabled();
const footballSport = enabledSports.find((s) => s.slug === "football");
const tagId = footballSport?.polymarketTagId ?? 100350;

const enabledLeagueRows = await leaguesRepository.findEnabled();
const enabledLeagues = enabledLeagueRows.map((r) => ({
  id: r.id,
  sport: r.sport,
  name: r.name,
  country: r.country,
  type: r.type,
  polymarketSeriesSlug: r.polymarketSeriesSlug,
  domesticLeagueIds: r.domesticLeagueIds ?? undefined,
  tier: r.tier,
}));

logger.info("Loaded leagues from database", {
  sports: enabledSports.length,
  leagues: enabledLeagues.length,
  leagueNames: enabledLeagues.map((l) => l.name),
});

// ── Services ─────────────────────────────────────────────────────────
const discovery = createMarketDiscovery(gammaClient, {
  leagues: enabledLeagues,
  tagId,
  lookAheadDays: DEFAULT_CONFIG.fixtureLookAheadDays,
});
const bettingService = createBettingService({
  bettingClientFactory,
  betsRepo: bets,
  auditLog,
  bettingEventsRepo: bettingEvents,
  config: { ...DEFAULT_CONFIG.betting, proxyEnabled: !!env.PROXY_URL },
});
const bankrollProvider = createBankrollProvider({
  betsRepo: bets,
  initialBankroll: DEFAULT_CONFIG.betting.initialBankroll,
});
const settlementService = createSettlementService({
  gammaClient,
  betsRepo: bets,
  marketsRepo: markets,
  auditLog,
});

// ── Competitor registry (database-driven) ────────────────────────────
const engines = await loadCompetitors({
  competitorsRepo: comps,
  walletsRepo: wallets,
  encryptionKey: env.WALLET_ENCRYPTION_KEY,
  versionsRepo: versions,
  bettingEventsRepo: bettingEvents,
});

const registry = createRegistry();
for (const entry of engines) {
  registry.register(entry.competitorId, entry.name, entry.engine, entry.walletConfig);
}

// ── Order confirmation & retry services ──────────────────────────────
const walletConfigs = new Map<
  string,
  { polyPrivateKey: string; polyApiKey: string; polyApiSecret: string; polyApiPassphrase: string }
>();
for (const entry of engines) {
  if (entry.walletConfig) {
    walletConfigs.set(entry.competitorId, entry.walletConfig);
  }
}

const orderConfirmationService = createOrderConfirmationService({
  betsRepo: bets,
  bettingClientFactory,
  auditLog,
  walletConfigs,
  maxOrderAgeMs: DEFAULT_CONFIG.orderConfirmation.maxOrderAgeMs,
});

const betRetryService = createBetRetryService({
  betsRepo: bets,
  bettingClientFactory,
  auditLog,
  predictionsRepo: preds,
  walletConfigs,
  bankrollProvider,
  maxRetryAttempts: DEFAULT_CONFIG.retry.maxRetryAttempts,
  retryDelayMs: DEFAULT_CONFIG.retry.retryDelayMs,
  maxStakePerBet: DEFAULT_CONFIG.betting.maxStakePerBet,
  maxBumpPctOfBankroll: DEFAULT_CONFIG.retry.maxBumpPctOfBankroll,
  proxyEnabled: !!env.PROXY_URL,
});

// ── Notifications ────────────────────────────────────────────────────
const notifChannels = notificationChannelsRepo(db);
const notificationService = createNotificationService({
  channelsRepo: notifChannels,
  adapterFactories: defaultAdapterFactories,
});

// ── Pipelines & scheduler ────────────────────────────────────────────
const pipelineConfig = { ...DEFAULT_CONFIG, leagues: enabledLeagues };

const discoveryPipeline = createDiscoveryPipeline({
  discovery,
  footballClient,
  marketsRepo: markets,
  fixturesRepo: fixtures,
  leaguesRepo: leaguesRepository,
  config: pipelineConfig,
});

const predictionPipeline = createPredictionPipeline({
  gammaClient,
  footballClient,
  registry,
  bettingService,
  bankrollProvider,
  marketsRepo: markets,
  fixturesRepo: fixtures,
  predictionsRepo: preds,
  statsCache,
  leaguesRepo: leaguesRepository,
  config: pipelineConfig,
});

const fixtureStatusPipeline = createFixtureStatusPipeline({
  footballClient,
  fixturesRepo: fixtures,
});

const marketRefreshPipeline = createMarketRefreshPipeline({
  discovery,
  marketsRepo: markets,
  fixturesRepo: fixtures,
});

const redemptionPipeline = createRedemptionPipeline({
  betsRepo: bets,
  marketsRepo: markets,
  bettingClientFactory,
  auditLog,
  walletConfigs,
});

const summaryPipeline = createSummaryPipeline({
  betsRepo: bets,
  fixturesRepo: fixtures,
  competitorsRepo: comps,
  notificationService,
});

const scheduler = createScheduler({
  discoveryPipeline,
  predictionPipeline,
  settlementService,
  fixtureStatusPipeline,
  marketRefreshPipeline,
  orderConfirmationService,
  betRetryService,
  redemptionPipeline,
  summaryPipeline,
  notificationService,
  config: pipelineConfig,
});

// ── HTTP server ──────────────────────────────────────────────────────
const api = createApi({
  competitorsRepo: comps,
  competitorVersionsRepo: versions,
  betsRepo: bets,
  predictionsRepo: preds,
  marketsRepo: markets,
  fixturesRepo: fixtures,
  walletsRepo: wallets,
  auditLogRepo: auditLog,
  bankrollProvider,
  initialBankroll: DEFAULT_CONFIG.betting.initialBankroll,
});

api.get("/health", (c) => c.json({ status: "ok" }));

// Serve static UI files in production
api.use("/*", serveStatic({ root: "./ui/dist" }));
api.get("*", serveStatic({ root: "./ui/dist", path: "index.html" }));

const server = Bun.serve({
  port: env.PORT,
  fetch: api.fetch,
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
