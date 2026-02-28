import type { Statistics } from "../../domain/contracts/statistics";
import { computeH2hAdvantage, computeHomeWinRate, parseForm } from "../baseline/engine";

export type FeatureExtractor = (statistics: Statistics) => number;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const FEATURE_REGISTRY: Record<string, FeatureExtractor> = {
  homeWinRate: (stats) => computeHomeWinRate(stats.homeTeam),

  awayLossRate: (stats) => {
    const away = stats.awayTeam.awayRecord;
    if (away.played === 0) return 0.5;
    return away.losses / away.played;
  },

  formDiff: (stats) => {
    const homeScore = parseForm(stats.homeTeam.form);
    const awayScore = parseForm(stats.awayTeam.form);
    const diff = homeScore - awayScore;
    return (diff + 1) / 2;
  },

  h2h: (stats) => computeH2hAdvantage(stats.h2h),

  goalDiff: (stats) => {
    const home = stats.homeTeam;
    const away = stats.awayTeam;
    const homeGDPerGame = home.played > 0 ? home.goalDifference / home.played : 0;
    const awayGDPerGame = away.played > 0 ? away.goalDifference / away.played : 0;
    return clamp((homeGDPerGame - awayGDPerGame) / 4 + 0.5, 0, 1);
  },

  pointsPerGame: (stats) => {
    const homePPG = stats.homeTeam.played > 0 ? stats.homeTeam.points / stats.homeTeam.played : 0;
    const awayPPG = stats.awayTeam.played > 0 ? stats.awayTeam.points / stats.awayTeam.played : 0;
    return clamp((homePPG - awayPPG) / 3 + 0.5, 0, 1);
  },

  defensiveStrength: (stats) => {
    const homeGA =
      stats.homeTeam.played > 0 ? stats.homeTeam.goalsAgainst / stats.homeTeam.played : 0;
    const awayGA =
      stats.awayTeam.played > 0 ? stats.awayTeam.goalsAgainst / stats.awayTeam.played : 0;
    return clamp((awayGA - homeGA) / 2 + 0.5, 0, 1);
  },
};

export function extractFeatures(statistics: Statistics): Record<string, number> {
  const features: Record<string, number> = {};
  for (const [name, extractor] of Object.entries(FEATURE_REGISTRY)) {
    features[name] = extractor(statistics);
  }
  return features;
}
