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
  fixtureLookAheadDays: 14,
  discoveryIntervalMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  predictionIntervalMs: 15 * 60 * 1000, // 15 minutes
  settlementIntervalMs: 2 * 60 * 60 * 1000, // 2 hours
  fixtureStatusIntervalMs: 15 * 60 * 1000, // 15 minutes
  predictionLeadTimeMs: 30 * 60 * 1000, // 30 minutes before kickoff
  predictionDelayMs: 30_000,
  betting: {
    maxStakePerBet: 10,
    maxBetPctOfBankroll: 0.1,
    maxTotalExposure: 100,
    initialBankroll: 100,
    minBetAmount: 0.01,
    dryRun: true,
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
