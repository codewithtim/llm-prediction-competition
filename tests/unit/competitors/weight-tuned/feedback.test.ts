import { describe, expect, test } from "bun:test";
import {
  buildWeightFeedbackPrompt,
  type LeaderboardEntry,
  type PredictionOutcome,
} from "../../../../src/competitors/weight-tuned/feedback";
import { DEFAULT_WEIGHTS, type WeightConfig } from "../../../../src/competitors/weight-tuned/types";

function makeInput(
  overrides: {
    currentWeights?: WeightConfig;
    totalBets?: number;
    wins?: number;
    losses?: number;
    recentOutcomes?: PredictionOutcome[];
    leaderboard?: LeaderboardEntry[];
  } = {},
) {
  return {
    currentWeights: overrides.currentWeights ?? DEFAULT_WEIGHTS,
    performance: {
      totalBets: overrides.totalBets ?? 10,
      wins: overrides.wins ?? 6,
      losses: overrides.losses ?? 4,
      accuracy: (overrides.wins ?? 6) / ((overrides.wins ?? 6) + (overrides.losses ?? 4)),
      roi: 0.12,
      profitLoss: 5.5,
    },
    recentOutcomes: overrides.recentOutcomes ?? [],
    leaderboard: overrides.leaderboard ?? [],
  };
}

describe("buildWeightFeedbackPrompt", () => {
  test("includes weight configuration section", () => {
    const prompt = buildWeightFeedbackPrompt(makeInput());

    expect(prompt).toContain("## Your Current Weight Configuration");
    expect(prompt).toContain('"homeWinRate"');
  });

  test("does not reference TypeScript engine in instructions", () => {
    const prompt = buildWeightFeedbackPrompt(makeInput());

    expect(prompt).not.toContain("TypeScript engine");
  });

  test("references weight configuration in instructions", () => {
    const prompt = buildWeightFeedbackPrompt(makeInput());

    expect(prompt).toContain("weight configuration");
  });

  test("includes performance summary", () => {
    const prompt = buildWeightFeedbackPrompt(makeInput({ totalBets: 15, wins: 9, losses: 6 }));

    expect(prompt).toContain("Total Bets: 15");
    expect(prompt).toContain("Wins: 9");
    expect(prompt).toContain("Losses: 6");
  });

  test("includes signal weights table", () => {
    const prompt = buildWeightFeedbackPrompt(makeInput());

    expect(prompt).toContain("### Signal Weights");
    expect(prompt).toContain("homeWinRate");
    expect(prompt).toContain("### Parameters");
    expect(prompt).toContain("drawBaseline");
  });

  test("includes recent outcomes when provided", () => {
    const outcomes: PredictionOutcome[] = [
      {
        marketQuestion: "Will Arsenal win?",
        side: "YES",
        confidence: 0.75,
        stake: 3.5,
        result: "won",
        profit: 2.1,
      },
    ];
    const prompt = buildWeightFeedbackPrompt(makeInput({ recentOutcomes: outcomes }));

    expect(prompt).toContain("Will Arsenal win?");
    expect(prompt).toContain("WIN");
  });

  test("includes leaderboard when provided", () => {
    const leaderboard: LeaderboardEntry[] = [
      { name: "Top Bot", accuracy: 0.7, roi: 0.15, profitLoss: 12.0 },
      { name: "Test Bot", accuracy: 0.55, roi: -0.05, profitLoss: -2.0 },
    ];
    const prompt = buildWeightFeedbackPrompt(makeInput({ leaderboard }));

    expect(prompt).toContain("Top Bot");
    expect(prompt).toContain("Test Bot");
  });

  test("includes improvement suggestions for poor YES bet performance", () => {
    const outcomes: PredictionOutcome[] = [
      { marketQuestion: "Q1", side: "YES", confidence: 0.6, stake: 2, result: "lost", profit: -2 },
      { marketQuestion: "Q2", side: "YES", confidence: 0.6, stake: 2, result: "lost", profit: -2 },
      { marketQuestion: "Q3", side: "YES", confidence: 0.6, stake: 2, result: "lost", profit: -2 },
      { marketQuestion: "Q4", side: "YES", confidence: 0.6, stake: 2, result: "won", profit: 1 },
    ];
    const prompt = buildWeightFeedbackPrompt(makeInput({ recentOutcomes: outcomes }));

    expect(prompt).toContain("YES bets are underperforming");
  });

  test("does not include engine code section", () => {
    const prompt = buildWeightFeedbackPrompt(makeInput());

    expect(prompt).not.toContain("## Your Current Engine Code");
  });
});
