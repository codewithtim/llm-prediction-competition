import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ChangelogEntry } from "../competitors/weight-tuned/types.ts";
import type { Reasoning } from "../domain/contracts/prediction.ts";
import type { PlayerSeasonStats, TeamSeasonStats } from "../domain/contracts/statistics.ts";

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
  lockedAmount: number;
  totalStaked: number;
  totalReturned: number;
  roundWins?: number;
  roundLosses?: number;
  roundPnl?: number;
  avgEdgeAtBet?: number;
  winningSignals?: string[];
  losingSignals?: string[];
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
  reasoning: text("reasoning", { mode: "json" }).$type<{
    changelog: ChangelogEntry[];
    overallAssessment: string;
  }>(),
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
  stakeAdjustment: text("stake_adjustment", { mode: "json" }).$type<{
    originalStake: number;
    adjustedStake: number;
    reason: string;
    minSizeFromError: number;
    adjustedAt: string;
  }>(),
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
      "order_too_small",
      "geo_restricted",
      "unknown",
    ],
  }),
  attempts: integer("attempts").notNull().default(0),
  lastAttemptAt: integer("last_attempt_at", { mode: "timestamp" }),
  redeemedAt: integer("redeemed_at", { mode: "timestamp" }),
  redemptionTxHash: text("redemption_tx_hash"),
});

export const betAuditLog = sqliteTable(
  "bet_audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    betId: text("bet_id")
      .notNull()
      .references(() => bets.id),
    event: text("event", {
      enum: [
        "bet_created",
        "order_submitted",
        "order_failed",
        "order_confirmed",
        "order_cancelled",
        "stuck_bet_recovered",
        "ghost_order_detected",
        "retry_started",
        "retry_succeeded",
        "retry_failed",
        "bet_settled",
        "bet_redeemed",
      ],
    }).notNull(),
    statusBefore: text("status_before", {
      enum: [
        "submitting",
        "pending",
        "filled",
        "settled_won",
        "settled_lost",
        "cancelled",
        "failed",
      ],
    }),
    statusAfter: text("status_after", {
      enum: [
        "submitting",
        "pending",
        "filled",
        "settled_won",
        "settled_lost",
        "cancelled",
        "failed",
      ],
    }).notNull(),
    orderId: text("order_id"),
    error: text("error"),
    errorCategory: text("error_category", {
      enum: [
        "insufficient_funds",
        "network_error",
        "rate_limited",
        "wallet_error",
        "invalid_market",
        "order_too_small",
        "geo_restricted",
        "unknown",
      ],
    }),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    timestamp: integer("timestamp", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("bet_audit_log_bet_id_idx").on(table.betId)],
);

export const notificationChannels = sqliteTable("notification_channels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type", { enum: ["discord", "twitter"] }).notNull(),
  config: text("config", { mode: "json" }).$type<Record<string, string>>().notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  eventFilter: text("event_filter", { mode: "json" }).$type<string[]>(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
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

export const sports = sqliteTable("sports", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  polymarketTagId: integer("polymarket_tag_id"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const leagues = sqliteTable("leagues", {
  id: integer("id").primaryKey(),
  sport: text("sport")
    .notNull()
    .references(() => sports.slug),
  name: text("name").notNull(),
  country: text("country").notNull(),
  type: text("type", { enum: ["cup", "league"] }).notNull(),
  polymarketSeriesSlug: text("polymarket_series_slug").notNull(),
  domesticLeagueIds: text("domestic_league_ids", { mode: "json" }).$type<number[]>(),
  tier: integer("tier").notNull().default(5),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const bettingEvents = sqliteTable(
  "betting_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    competitorId: text("competitor_id").notNull(),
    marketId: text("market_id"),
    fixtureId: integer("fixture_id"),
    event: text("event", {
      enum: ["bet_skipped", "bet_dry_run", "wallet_load_failed", "wallet_not_found"],
    }).notNull(),
    reason: text("reason"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    timestamp: integer("timestamp", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("betting_events_competitor_idx").on(table.competitorId),
    index("betting_events_event_idx").on(table.event),
  ],
);
