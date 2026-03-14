import type { BettingConfig } from "../domain/services/betting.ts";

export type LeagueConfig = {
  id: number;
  sport: string;
  name: string;
  country: string;
  type: "cup" | "league";
  polymarketSeriesSlug: string;
  domesticLeagueIds?: number[];
  tier: number;
};

export type OrderConfirmationConfig = {
  intervalMs: number;
  maxOrderAgeMs: number;
};

export type RetryConfig = {
  intervalMs: number;
  maxRetryAttempts: number;
  retryDelayMs: number;
};

export type PipelineConfig = {
  leagues: LeagueConfig[];
  season?: number;
  fixtureLookAheadDays: number;
  discoveryIntervalMs: number;
  predictionIntervalMs: number;
  settlementIntervalMs: number;
  fixtureStatusIntervalMs: number;
  predictionLeadTimeMs: number;
  discoveryDelayMs?: number;
  predictionDelayMs?: number;
  settlementDelayMs?: number;
  marketRefreshIntervalMs: number;
  marketRefreshDelayMs?: number;
  summaryIntervalMs: number;
  summaryDelayMs?: number;
  betting: BettingConfig;
  orderConfirmation: OrderConfirmationConfig;
  retry: RetryConfig;
};

export const LEAGUE_CATALOG = {
  premierLeague: {
    id: 39,
    sport: "football",
    name: "Premier League",
    country: "England",
    type: "league",
    polymarketSeriesSlug: "premier-league",
    tier: 1,
  },
  championsLeague: {
    id: 2,
    sport: "football",
    name: "Champions League",
    country: "World",
    type: "cup",
    polymarketSeriesSlug: "ucl",
    domesticLeagueIds: [39, 140, 135, 78, 61],
    tier: 1,
  },
  laLiga: {
    id: 140,
    sport: "football",
    name: "La Liga",
    country: "Spain",
    type: "league",
    polymarketSeriesSlug: "la-liga",
    tier: 1,
  },
  serieA: {
    id: 135,
    sport: "football",
    name: "Serie A",
    country: "Italy",
    type: "league",
    polymarketSeriesSlug: "serie-a",
    tier: 1,
  },
  bundesliga: {
    id: 78,
    sport: "football",
    name: "Bundesliga",
    country: "Germany",
    type: "league",
    polymarketSeriesSlug: "bundesliga",
    tier: 1,
  },
  ligue1: {
    id: 61,
    sport: "football",
    name: "Ligue 1",
    country: "France",
    type: "league",
    polymarketSeriesSlug: "ligue-1",
    tier: 1,
  },
  championship: {
    id: 40,
    sport: "football",
    name: "Championship",
    country: "England",
    type: "league",
    polymarketSeriesSlug: "efl-championship",
    tier: 2,
  },
  faCup: {
    id: 45,
    sport: "football",
    name: "FA Cup",
    country: "England",
    type: "cup",
    polymarketSeriesSlug: "fa-cup",
    domesticLeagueIds: [39, 40, 41, 42],
    tier: 2,
  },
} as const satisfies Record<string, LeagueConfig>;

export const DEFAULT_CONFIG: PipelineConfig = {
  leagues: [],
  fixtureLookAheadDays: 14,
  discoveryIntervalMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  predictionIntervalMs: 15 * 60 * 1000, // 15 minutes
  settlementIntervalMs: 2 * 60 * 60 * 1000, // 2 hours
  fixtureStatusIntervalMs: 15 * 60 * 1000, // 15 minutes
  marketRefreshIntervalMs: 15 * 60 * 1000, // 15 minutes
  predictionLeadTimeMs: 30 * 60 * 1000, // 30 minutes before kickoff
  predictionDelayMs: 30_000,
  summaryIntervalMs: 7 * 24 * 60 * 60 * 1000, // weekly
  betting: {
    maxStakePerBet: 10,
    maxBetPctOfBankroll: 0.1,
    maxTotalExposure: 10,
    initialBankroll: 10,
    minBetAmount: 0.01,
    dryRun: false,
    proxyEnabled: false,
  },
  orderConfirmation: {
    intervalMs: 5 * 60 * 1000, // 5 minutes
    maxOrderAgeMs: 60 * 60 * 1000, // 1 hour
  },
  retry: {
    intervalMs: 10 * 60 * 1000, // 10 minutes
    maxRetryAttempts: 3,
    retryDelayMs: 60_000, // minimum 1 minute between retry attempts
  },
};
