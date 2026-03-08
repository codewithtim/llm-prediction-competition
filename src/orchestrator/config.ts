import type { BettingConfig } from "../domain/services/betting.ts";

export type LeagueConfig = {
  id: number;
  name: string;
  country: string;
  type: "cup" | "league";
  polymarketTagIds: number[];
  polymarketSeriesSlug: string;
  domesticLeagueIds?: number[];
};

export const LEAGUE_TIERS: Record<number, number> = {
  39: 1, // Premier League
  40: 2, // Championship
  41: 3, // League One
  42: 4, // League Two
  140: 1, // La Liga
  135: 1, // Serie A
  78: 1, // Bundesliga
  61: 1, // Ligue 1
};

export const DEFAULT_LEAGUE_TIER = 5;

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
    type: "league",
    polymarketTagIds: [82],
    polymarketSeriesSlug: "premier-league",
  },
  championsLeague: {
    id: 2,
    name: "Champions League",
    country: "World",
    type: "cup",
    polymarketTagIds: [100977],
    polymarketSeriesSlug: "ucl",
    domesticLeagueIds: [39, 140, 135, 78, 61],
  },
  laLiga: {
    id: 140,
    name: "La Liga",
    country: "Spain",
    type: "league",
    polymarketTagIds: [306],
    polymarketSeriesSlug: "la-liga",
  },
  serieA: {
    id: 135,
    name: "Serie A",
    country: "Italy",
    type: "league",
    polymarketTagIds: [100350],
    polymarketSeriesSlug: "serie-a",
  },
  bundesliga: {
    id: 78,
    name: "Bundesliga",
    country: "Germany",
    type: "league",
    polymarketTagIds: [100350],
    polymarketSeriesSlug: "bundesliga",
  },
  ligue1: {
    id: 61,
    name: "Ligue 1",
    country: "France",
    type: "league",
    polymarketTagIds: [100350],
    polymarketSeriesSlug: "ligue-1",
  },
  faCup: {
    id: 45,
    name: "FA Cup",
    country: "England",
    type: "cup",
    polymarketTagIds: [101807],
    polymarketSeriesSlug: "fa-cup",
    domesticLeagueIds: [39, 40, 41, 42],
  },
} as const satisfies Record<string, LeagueConfig>;

export const DEFAULT_LEAGUES: LeagueConfig[] = [
  LEAGUE_CATALOG.premierLeague,
  LEAGUE_CATALOG.championsLeague,
  LEAGUE_CATALOG.faCup,
];

export const DEFAULT_CONFIG: PipelineConfig = {
  leagues: DEFAULT_LEAGUES,
  fixtureLookAheadDays: 14,
  discoveryIntervalMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  predictionIntervalMs: 15 * 60 * 1000, // 15 minutes
  settlementIntervalMs: 2 * 60 * 60 * 1000, // 2 hours
  fixtureStatusIntervalMs: 15 * 60 * 1000, // 15 minutes
  marketRefreshIntervalMs: 15 * 60 * 1000, // 15 minutes
  predictionLeadTimeMs: 30 * 60 * 1000, // 30 minutes before kickoff
  predictionDelayMs: 30_000,
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
