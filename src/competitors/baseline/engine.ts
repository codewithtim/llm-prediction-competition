import type { PredictionOutput } from "../../domain/contracts/prediction";
import type { H2H, Statistics, TeamStats } from "../../domain/contracts/statistics";
import type { PredictionEngine } from "../../engine/types";

export const BASELINE_ID = "baseline";
export const BASELINE_NAME = "Manual Baseline";

const WEIGHT_HOME = 0.4;
const WEIGHT_FORM = 0.3;
const WEIGHT_H2H = 0.3;

export function parseForm(form: string | null): number {
  if (!form) return 0.5;
  let score = 0;
  let count = 0;
  for (const ch of form) {
    if (ch === "W") {
      score += 1;
      count++;
    } else if (ch === "D") {
      score += 0.5;
      count++;
    } else if (ch === "L") {
      count++;
    }
  }
  return count === 0 ? 0.5 : score / count;
}

export function computeHomeWinRate(home: TeamStats): number {
  if (home.homeRecord.played === 0) return 0.5;
  return home.homeRecord.wins / home.homeRecord.played;
}

export function computeFormAdvantage(home: TeamStats, away: TeamStats): number {
  const homeScore = parseForm(home.form);
  const awayScore = parseForm(away.form);
  const diff = homeScore - awayScore; // range [-1, 1]
  return (diff + 1) / 2; // map to [0, 1]
}

export function computeH2hAdvantage(h2h: H2H): number {
  if (h2h.totalMatches === 0) return 0.5;
  return h2h.homeWins / h2h.totalMatches;
}

export function computeStake(confidence: number): number {
  return Math.max(1, 1 + (confidence - 0.5) * 18);
}

export const baselineEngine = ((statistics: Statistics): PredictionOutput[] => {
  const homeWinRate = computeHomeWinRate(statistics.homeTeam);
  const formAdvantage = computeFormAdvantage(statistics.homeTeam, statistics.awayTeam);
  const h2hAdvantage = computeH2hAdvantage(statistics.h2h);

  const composite =
    WEIGHT_HOME * homeWinRate + WEIGHT_FORM * formAdvantage + WEIGHT_H2H * h2hAdvantage;

  const side: "YES" | "NO" = composite >= 0.5 ? "YES" : "NO";
  const confidence = composite >= 0.5 ? composite : 1 - composite;
  const stake = computeStake(confidence);

  const reasoning =
    `Home win rate: ${(homeWinRate * 100).toFixed(0)}%, ` +
    `Form advantage: ${(formAdvantage * 100).toFixed(0)}%, ` +
    `H2H advantage: ${(h2hAdvantage * 100).toFixed(0)}% → ` +
    `Composite: ${(composite * 100).toFixed(1)}% → ${side}`;

  return [
    {
      marketId: statistics.market.marketId,
      side,
      confidence,
      stake,
      reasoning,
    },
  ];
}) satisfies PredictionEngine;
