import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Reasoning } from "../../domain/contracts/prediction.ts";
import type { PlayerSeasonStats, TeamSeasonStats } from "../../domain/contracts/statistics.ts";

export const markets = sqliteTable("markets", {
  id: text("id").primaryKey(),
  conditionId: text("condition_id").notNull(),
  slug: text("slug").notNull(),
  question: text("question").notNull(),
  outcomes: text("outcomes", { mode: "json" }).notNull().$type<[string, string]>(),
  outcomePrices: text("outcome_prices", { mode: "json" }).notNull().$type<[string, string]>(),
  tokenIds: text("token_ids", { mode: "json" }).notNull().$type<[string, string]>(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  closed: integer("closed", { mode: "boolean" }).notNull().default(false),
  acceptingOrders: integer("accepting_orders", { mode: "boolean" }).notNull().default(true),
  liquidity: real("liquidity").notNull().default(0),
  volume: real("volume").notNull().default(0),
  gameId: text("game_id"),
  sportsMarketType: text("sports_market_type"),
  line: real("line"),
  polymarketUrl: text("polymarket_url"),
  fixtureId: integer("fixture_id").references(() => fixtures.id),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const fixtures = sqliteTable("fixtures", {
  id: integer("id").primaryKey(),
  leagueId: integer("league_id").notNull(),
  leagueName: text("league_name").notNull(),
  leagueCountry: text("league_country").notNull(),
  leagueSeason: integer("league_season").notNull(),
  homeTeamId: integer("home_team_id").notNull(),
  homeTeamName: text("home_team_name").notNull(),
  homeTeamLogo: text("home_team_logo"),
  awayTeamId: integer("away_team_id").notNull(),
  awayTeamName: text("away_team_name").notNull(),
  awayTeamLogo: text("away_team_logo"),
  date: text("date").notNull(),
  venue: text("venue"),
  status: text("status", {
    enum: ["scheduled", "in_progress", "finished", "postponed", "cancelled"],
  })
    .notNull()
    .default("scheduled"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const competitors = sqliteTable("competitors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  model: text("model").notNull(),
  enginePath: text("engine_path"),
  status: text("status").notNull().default("active"),
  type: text("type").notNull().default("weight-tuned"),
  config: text("config"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type PerformanceSnapshot = {
  totalBets: number;
  wins: number;
  losses: number;
  accuracy: number;
  roi: number;
  profitLoss: number;
};

export const competitorVersions = sqliteTable("competitor_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  competitorId: text("competitor_id")
    .notNull()
    .references(() => competitors.id),
  version: integer("version").notNull(),
  code: text("code").notNull(),
  rawLlmOutput: text("raw_llm_output"),
  enginePath: text("engine_path").notNull(),
  model: text("model").notNull(),
  performanceSnapshot: text("performance_snapshot", { mode: "json" }).$type<PerformanceSnapshot>(),
  generatedAt: integer("generated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const competitorWallets = sqliteTable("competitor_wallets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  competitorId: text("competitor_id")
    .notNull()
    .unique()
    .references(() => competitors.id),
  walletAddress: text("wallet_address").notNull(),
  encryptedPrivateKey: text("encrypted_private_key").notNull(),
  encryptedApiKey: text("encrypted_api_key").notNull(),
  encryptedApiSecret: text("encrypted_api_secret").notNull(),
  encryptedApiPassphrase: text("encrypted_api_passphrase").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const predictions = sqliteTable("predictions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  marketId: text("market_id")
    .notNull()
    .references(() => markets.id),
  fixtureId: integer("fixture_id")
    .notNull()
    .references(() => fixtures.id),
  competitorId: text("competitor_id")
    .notNull()
    .references(() => competitors.id),
  side: text("side", { enum: ["YES", "NO"] }).notNull(),
  confidence: real("confidence").notNull(),
  stake: real("stake").notNull(),
  reasoning: text("reasoning", { mode: "json" }).notNull().$type<Reasoning>(),
  extractedFeatures: text("extracted_features", { mode: "json" }).$type<Record<string, number>>(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const bets = sqliteTable("bets", {
  id: text("id").primaryKey(),
  orderId: text("order_id"),
  marketId: text("market_id")
    .notNull()
    .references(() => markets.id),
  fixtureId: integer("fixture_id")
    .notNull()
    .references(() => fixtures.id),
  competitorId: text("competitor_id")
    .notNull()
    .references(() => competitors.id),
  tokenId: text("token_id").notNull(),
  side: text("side", { enum: ["YES", "NO"] }).notNull(),
  amount: real("amount").notNull(),
  price: real("price").notNull(),
  shares: real("shares").notNull(),
  status: text("status", {
    enum: ["submitting", "pending", "filled", "settled_won", "settled_lost", "cancelled", "failed"],
  })
    .notNull()
    .default("pending"),
  placedAt: integer("placed_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  settledAt: integer("settled_at", { mode: "timestamp" }),
  profit: real("profit"),
  errorMessage: text("error_message"),
  errorCategory: text("error_category", {
    enum: [
      "insufficient_funds",
      "network_error",
      "rate_limited",
      "wallet_error",
      "invalid_market",
      "unknown",
    ],
  }),
  attempts: integer("attempts").notNull().default(0),
  lastAttemptAt: integer("last_attempt_at", { mode: "timestamp" }),
});

export const teamStatsCache = sqliteTable("team_stats_cache", {
  id: text("id").primaryKey(),
  teamId: integer("team_id").notNull(),
  leagueId: integer("league_id").notNull(),
  season: integer("season").notNull(),
  data: text("data", { mode: "json" }).$type<TeamSeasonStats>().notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
});

export const playerStatsCache = sqliteTable("player_stats_cache", {
  id: text("id").primaryKey(),
  teamId: integer("team_id").notNull(),
  leagueId: integer("league_id").notNull(),
  season: integer("season").notNull(),
  data: text("data", { mode: "json" }).$type<PlayerSeasonStats[]>().notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
});
