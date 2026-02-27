import type { BettingConfig } from "../domain/services/betting.ts";

export type LeagueConfig = {
  id: number;
  name: string;
  country: string;
  polymarketTagIds: number[];
  polymarketSeriesSlug: string;
};

export type PipelineConfig = {
  leagues: LeagueConfig[];
  season: number;
  fixtureLookAheadDays: number;
  predictionIntervalMs: number;
  settlementIntervalMs: number;
  betting: BettingConfig;
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
  season: 2026,
  fixtureLookAheadDays: 7,
  predictionIntervalMs: 6 * 60 * 60 * 1000, // 6 hours
  settlementIntervalMs: 2 * 60 * 60 * 1000, // 2 hours
  betting: {
    maxStakePerBet: 10,
    maxTotalExposure: 100,
    dryRun: true,
  },
};
