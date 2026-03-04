import { describe, expect, test } from "bun:test";
import {
  buildWeightFeedbackPrompt,
  formatOutcomeFeatures,
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
      lockedAmount: 12.0,
      totalStaked: 50.0,
      totalReturned: 55.5,
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

  test("includes features for settled outcomes", () => {
    const outcomes: PredictionOutcome[] = [
      {
        marketQuestion: "Will Arsenal win?",
        side: "YES",
        confidence: 0.75,
        stake: 3.5,
        result: "won",
        profit: 2.1,
        extractedFeatures: { homeWinRate: 0.9, formDiff: 0.6, h2h: 0.6 },
      },
      {
        marketQuestion: "Will Chelsea win?",
        side: "NO",
        confidence: 0.55,
        stake: 1.0,
        result: "pending",
        profit: null,
        extractedFeatures: { homeWinRate: 0.4, formDiff: 0.5, h2h: 0.3 },
      },
    ];
    const prompt = buildWeightFeedbackPrompt(makeInput({ recentOutcomes: outcomes }));

    // Settled outcome (won) should show features
    expect(prompt).toContain("Features:");
    expect(prompt).toContain("homeWinRate=90%");
    // Pending outcome should NOT show features
    const pendingIdx = prompt.indexOf("Will Chelsea win?");
    const afterPending = prompt.slice(pendingIdx);
    expect(afterPending).not.toContain("Features:");
  });

  test("handles outcomes without extractedFeatures", () => {
    const outcomes: PredictionOutcome[] = [
      {
        marketQuestion: "Will Arsenal win?",
        side: "YES",
        confidence: 0.75,
        stake: 3.5,
        result: "lost",
        profit: -3.5,
      },
    ];
    const prompt = buildWeightFeedbackPrompt(makeInput({ recentOutcomes: outcomes }));

    expect(prompt).toContain("Will Arsenal win?");
    expect(prompt).toContain("LOSS");
    expect(prompt).not.toContain("Features:");
  });

  test("includes staking stats in performance summary", () => {
    const prompt = buildWeightFeedbackPrompt(makeInput());

    expect(prompt).toContain("Total Staked: +50.00");
    expect(prompt).toContain("Total Returned: +55.50");
    expect(prompt).toContain("Locked in Active Bets: +12.00");
  });

  test("includes feature analysis instruction", () => {
    const prompt = buildWeightFeedbackPrompt(makeInput());

    expect(prompt).toContain("Feature values that correlated with wins vs losses");
  });
});

describe("formatOutcomeFeatures", () => {
  test("shows active features with weights", () => {
    const features = { homeWinRate: 0.9, formDiff: 0.6, h2h: 0.15, defensiveStrength: 0.82 };
    const weights = { homeWinRate: 0.4, formDiff: 0.3, h2h: 0.3, defensiveStrength: 0 };

    const result = formatOutcomeFeatures(features, weights);

    expect(result).toContain("homeWinRate=90%");
    expect(result).toContain("w=0.40");
    expect(result).toContain("formDiff=60%");
    expect(result).toContain("h2h=15%");
    expect(result).not.toContain("defensiveStrength");
  });

  test("returns empty string when no active features", () => {
    const features = { homeWinRate: 0.9 };
    const weights = { homeWinRate: 0 };

    const result = formatOutcomeFeatures(features, weights);

    expect(result).toBe("");
  });
});
