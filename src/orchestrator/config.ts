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
  season: number;
  fixtureLookAheadDays: number;
  discoveryIntervalMs: number;
  predictionIntervalMs: number;
  settlementIntervalMs: number;
  discoveryDelayMs?: number;
  predictionDelayMs?: number;
  settlementDelayMs?: number;
  betting: BettingConfig;
  orderConfirmation: OrderConfirmationConfig;
  retry: RetryConfig;
};

export const DEFAULT_LEAGUES: LeagueConfig[] = [
  {
    id: 39,
    name: "Premier League",
    country: "England",
    polymarketTagIds: [82],
    polymarketSeriesSlug: "premier-league",
  },
];

export const DEFAULT_CONFIG: PipelineConfig = {
  leagues: DEFAULT_LEAGUES,
  season: 2025,
  fixtureLookAheadDays: 7,
  discoveryIntervalMs: 30 * 60 * 1000, // 30 minutes
  predictionIntervalMs: 6 * 60 * 60 * 1000, // 6 hours
  settlementIntervalMs: 2 * 60 * 60 * 1000, // 2 hours
  predictionDelayMs: 30_000,
  betting: {
    maxStakePerBet: 10,
    maxBetPctOfBankroll: 0.1,
    maxTotalExposure: 100,
    initialBankroll: 100,
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
