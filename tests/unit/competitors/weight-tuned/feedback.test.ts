import { describe, expect, test } from "bun:test";
import {
  buildWeightFeedbackPrompt,
  computeSignalCorrelations,
  formatOutcomeFeatures,
  formatPerformanceHistory,
  type LeaderboardEntry,
  type PerformanceRound,
  type PredictionOutcome,
  type WeightFeedbackInput,
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
    performanceHistory?: PerformanceRound[];
    signalCorrelations?: { winningSignals: string[]; losingSignals: string[] };
    previousReasoning?: WeightFeedbackInput["previousReasoning"];
  } = {},
): WeightFeedbackInput {
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
    performanceHistory: overrides.performanceHistory ?? [],
    signalCorrelations: overrides.signalCorrelations ?? {
      winningSignals: [],
      losingSignals: [],
    },
    previousReasoning: overrides.previousReasoning,
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

    expect(prompt).toContain("Features:");
    expect(prompt).toContain("homeWinRate=90%");
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

    expect(prompt).toContain("signal weights correlate with your wins vs losses");
  });

  test("includes performance history section", () => {
    const history: PerformanceRound[] = [
      {
        version: 1,
        dateFrom: "2026-02-20",
        dateTo: "2026-02-25",
        betsSettled: 8,
        wins: 5,
        losses: 3,
        pnl: 2.5,
        avgEdge: 0.08,
        winningSignals: ["formDiff", "homeWinRate"],
        losingSignals: ["h2h"],
      },
      {
        version: 2,
        dateFrom: "2026-02-25",
        dateTo: "2026-03-01",
        betsSettled: 12,
        wins: 7,
        losses: 5,
        pnl: 1.8,
        avgEdge: 0.06,
        winningSignals: ["homeWinRate"],
        losingSignals: ["formDiff", "h2h"],
      },
    ];
    const prompt = buildWeightFeedbackPrompt(makeInput({ performanceHistory: history }));

    expect(prompt).toContain("## Performance History");
    expect(prompt).toContain("Round 1");
    expect(prompt).toContain("2026-02-20");
    expect(prompt).toContain("8 bets settled");
    expect(prompt).toContain("5W / 3L");
    expect(prompt).toContain("Round 2");
    expect(prompt).toContain("12 bets settled");
  });

  test("includes Rules section", () => {
    const prompt = buildWeightFeedbackPrompt(makeInput());

    expect(prompt).toContain("## Rules");
    expect(prompt).toContain("Do NOT overreact to a single bad matchday");
    expect(prompt).toContain("Small incremental adjustments");
    expect(prompt).toContain("fewer than 10 settled bets");
  });

  test("includes signal correlations in instructions", () => {
    const prompt = buildWeightFeedbackPrompt(
      makeInput({
        signalCorrelations: {
          winningSignals: ["formDiff", "homeWinRate"],
          losingSignals: ["h2h"],
        },
      }),
    );

    expect(prompt).toContain("wins driven by: formDiff, homeWinRate");
    expect(prompt).toContain("losses driven by: h2h");
  });

  test("shows no performance history when empty", () => {
    const prompt = buildWeightFeedbackPrompt(makeInput({ performanceHistory: [] }));

    expect(prompt).toContain("No performance history yet.");
  });

  test("includes previous reasoning when provided", () => {
    const prompt = buildWeightFeedbackPrompt(
      makeInput({
        previousReasoning: {
          changelog: [
            { parameter: "signals.h2h", previous: 0.3, new: 0.1, reason: "H2H was unreliable" },
            { parameter: "minEdge", previous: 0.05, new: 0.08, reason: "Be more selective" },
          ],
          overallAssessment: "Shifted focus away from H2H signal and increased selectivity.",
        },
      }),
    );

    expect(prompt).toContain("## Previous Assessment");
    expect(prompt).toContain("Shifted focus away from H2H signal and increased selectivity.");
    expect(prompt).toContain("signals.h2h");
    expect(prompt).toContain("0.3 → 0.1");
    expect(prompt).toContain("H2H was unreliable");
    expect(prompt).toContain("minEdge");
    expect(prompt).toContain("Be more selective");
  });

  test("omits previous reasoning when not provided", () => {
    const prompt = buildWeightFeedbackPrompt(makeInput());

    expect(prompt).not.toContain("## Previous Assessment");
    expect(prompt).not.toContain("Changes Made Last Round");
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

describe("computeSignalCorrelations", () => {
  test("returns top signals for wins and losses", () => {
    const outcomes: PredictionOutcome[] = [
      {
        marketQuestion: "Q1",
        side: "YES",
        confidence: 0.7,
        stake: 2,
        result: "won",
        profit: 1,
        extractedFeatures: { formDiff: 0.9, homeWinRate: 0.8, h2h: 0.3 },
      },
      {
        marketQuestion: "Q2",
        side: "YES",
        confidence: 0.6,
        stake: 2,
        result: "won",
        profit: 1,
        extractedFeatures: { formDiff: 0.85, homeWinRate: 0.75, h2h: 0.2 },
      },
      {
        marketQuestion: "Q3",
        side: "NO",
        confidence: 0.6,
        stake: 2,
        result: "lost",
        profit: -2,
        extractedFeatures: { formDiff: 0.3, homeWinRate: 0.4, h2h: 0.8 },
      },
    ];
    const weights = { formDiff: 0.3, homeWinRate: 0.4, h2h: 0.3 };

    const result = computeSignalCorrelations(outcomes, weights);

    expect(result.winningSignals[0]).toBe("homeWinRate");
    expect(result.winningSignals).toContain("formDiff");
    expect(result.losingSignals).toContain("h2h");
  });

  test("handles no settled bets", () => {
    const outcomes: PredictionOutcome[] = [
      {
        marketQuestion: "Q1",
        side: "YES",
        confidence: 0.7,
        stake: 2,
        result: "pending",
        profit: null,
        extractedFeatures: { formDiff: 0.9 },
      },
    ];

    const result = computeSignalCorrelations(outcomes, { formDiff: 0.3 });

    expect(result.winningSignals).toEqual([]);
    expect(result.losingSignals).toEqual([]);
  });

  test("excludes zero-weight signals", () => {
    const outcomes: PredictionOutcome[] = [
      {
        marketQuestion: "Q1",
        side: "YES",
        confidence: 0.7,
        stake: 2,
        result: "won",
        profit: 1,
        extractedFeatures: { formDiff: 0.9, h2h: 0.95 },
      },
    ];
    const weights = { formDiff: 0.5, h2h: 0 };

    const result = computeSignalCorrelations(outcomes, weights);

    expect(result.winningSignals).toContain("formDiff");
    expect(result.winningSignals).not.toContain("h2h");
  });
});

describe("formatPerformanceHistory", () => {
  test("formats rounds chronologically", () => {
    const rounds: PerformanceRound[] = [
      {
        version: 1,
        dateFrom: "2026-02-20",
        dateTo: "2026-02-25",
        betsSettled: 5,
        wins: 3,
        losses: 2,
        pnl: 1.5,
        avgEdge: 0.07,
        winningSignals: ["formDiff"],
        losingSignals: ["h2h"],
      },
      {
        version: 2,
        dateFrom: "2026-02-25",
        dateTo: "2026-03-01",
        betsSettled: 8,
        wins: 5,
        losses: 3,
        pnl: 2.0,
        avgEdge: 0.09,
        winningSignals: ["homeWinRate", "formDiff"],
        losingSignals: [],
      },
      {
        version: 3,
        dateFrom: "2026-03-01",
        dateTo: "2026-03-04",
        betsSettled: 3,
        wins: 1,
        losses: 2,
        pnl: -0.8,
        avgEdge: 0.04,
        winningSignals: [],
        losingSignals: ["homeWinRate"],
      },
    ];

    const result = formatPerformanceHistory(rounds);

    expect(result).toContain("Round 1");
    expect(result).toContain("Round 2");
    expect(result).toContain("Round 3");
    expect(result).toContain("5 bets settled");
    expect(result).toContain("3W / 2L");
    expect(result).toContain("2026-02-20");
    expect(result).toContain("2026-02-25");
    expect(result).toContain("insufficient data");

    const round1Pos = result.indexOf("Round 1");
    const round2Pos = result.indexOf("Round 2");
    const round3Pos = result.indexOf("Round 3");
    expect(round1Pos).toBeLessThan(round2Pos);
    expect(round2Pos).toBeLessThan(round3Pos);
  });

  test("returns message for empty history", () => {
    const result = formatPerformanceHistory([]);

    expect(result).toBe("No performance history yet.");
  });
});
