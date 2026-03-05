import type { BettingConfig } from "../domain/services/betting.ts";

export type LeagueConfig = {
  id: number;
  name: string;
  country: string;
  polymarketTagIds: number[];
  polymarketSeriesSlug: string;
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
  betting: BettingConfig;
  orderConfirmation: OrderConfirmationConfig;
  retry: RetryConfig;
};

export const LEAGUE_CATALOG = {
  premierLeague: {
    id: 39,
    name: "Premier League",
    country: "England",
    polymarketTagIds: [82],
    polymarketSeriesSlug: "premier-league",
  },
  championsLeague: {
    id: 2,
    name: "Champions League",
    country: "World",
    polymarketTagIds: [100977],
    polymarketSeriesSlug: "ucl",
  },
  laLiga: {
    id: 140,
    name: "La Liga",
    country: "Spain",
    polymarketTagIds: [306],
    polymarketSeriesSlug: "la-liga",
  },
  serieA: {
    id: 135,
    name: "Serie A",
    country: "Italy",
    polymarketTagIds: [100350],
    polymarketSeriesSlug: "serie-a",
  },
  bundesliga: {
    id: 78,
    name: "Bundesliga",
    country: "Germany",
    polymarketTagIds: [100350],
    polymarketSeriesSlug: "bundesliga",
  },
  ligue1: {
    id: 61,
    name: "Ligue 1",
    country: "France",
    polymarketTagIds: [100350],
    polymarketSeriesSlug: "ligue-1",
  },
} as const satisfies Record<string, LeagueConfig>;

export const DEFAULT_LEAGUES: LeagueConfig[] = [
  LEAGUE_CATALOG.premierLeague,
  LEAGUE_CATALOG.championsLeague,
];

export const DEFAULT_CONFIG: PipelineConfig = {
  leagues: DEFAULT_LEAGUES,
  fixtureLookAheadDays: 14,
  discoveryIntervalMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  predictionIntervalMs: 15 * 60 * 1000, // 15 minutes
  settlementIntervalMs: 2 * 60 * 60 * 1000, // 2 hours
  fixtureStatusIntervalMs: 15 * 60 * 1000, // 15 minutes
  marketRefreshIntervalMs: 15 * 60 * 1000, // 15 minutes
  predictionLeadTimeMs: 3000 * 60 * 1000, // 30 minutes before kickoff
  predictionDelayMs: 30_000,
  betting: {
    maxStakePerBet: 10,
    maxBetPctOfBankroll: 0.1,
    maxTotalExposure: 10,
    initialBankroll: 10,
    minBetAmount: 0.01,
    dryRun: false,
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
