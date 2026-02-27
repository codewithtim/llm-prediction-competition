import type { BettingConfig } from "../domain/services/betting.ts";

export type LeagueConfig = {
  id: number;
  name: string;
  country: string;
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
  { id: 39, name: "Premier League", country: "England" },
  { id: 140, name: "La Liga", country: "Spain" },
  { id: 135, name: "Serie A", country: "Italy" },
  { id: 78, name: "Bundesliga", country: "Germany" },
  { id: 61, name: "Ligue 1", country: "France" },
];

export const DEFAULT_CONFIG: PipelineConfig = {
  leagues: DEFAULT_LEAGUES,
  season: 2024,
  fixtureLookAheadDays: 7,
  predictionIntervalMs: 6 * 60 * 60 * 1000, // 6 hours
  settlementIntervalMs: 2 * 60 * 60 * 1000, // 2 hours
  betting: {
    maxStakePerBet: 10,
    maxTotalExposure: 100,
    dryRun: true,
  },
};
