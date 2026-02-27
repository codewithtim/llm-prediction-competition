import { describe, expect, it } from "bun:test";
import {
  buildFeedbackPrompt,
  type FeedbackPromptInput,
  type LeaderboardEntry,
  type PerformanceStats,
  type PredictionOutcome,
} from "../../../../src/competitors/llm-codegen/feedback.ts";

function makePerformance(overrides?: Partial<PerformanceStats>): PerformanceStats {
  return {
    totalBets: 10,
    wins: 6,
    losses: 4,
    accuracy: 0.6,
    roi: 0.15,
    profitLoss: 3.5,
    ...overrides,
  };
}

function makeOutcome(overrides?: Partial<PredictionOutcome>): PredictionOutcome {
  return {
    marketQuestion: "Will Arsenal beat Chelsea?",
    side: "YES",
    confidence: 0.7,
    stake: 5,
    result: "won",
    profit: 3.2,
    ...overrides,
  };
}

function makeLeaderboardEntry(overrides?: Partial<LeaderboardEntry>): LeaderboardEntry {
  return {
    name: "Competitor A",
    accuracy: 0.65,
    roi: 0.2,
    profitLoss: 5.0,
    ...overrides,
  };
}

function makeInput(overrides?: Partial<FeedbackPromptInput>): FeedbackPromptInput {
  return {
    currentCode:
      'const engine = (stats) => [{ marketId: stats.market.marketId, side: "YES", confidence: 0.6, stake: 3, reasoning: "test" }];',
    performance: makePerformance(),
    recentOutcomes: [makeOutcome()],
    leaderboard: [makeLeaderboardEntry()],
    ...overrides,
  };
}

describe("buildFeedbackPrompt", () => {
  it("includes current engine code", () => {
    const code = "function myEngine() { return []; }";
    const prompt = buildFeedbackPrompt(makeInput({ currentCode: code }));

    expect(prompt).toContain(code);
    expect(prompt).toContain("Your Current Engine Code");
  });

  it("includes performance stats", () => {
    const prompt = buildFeedbackPrompt(
      makeInput({
        performance: makePerformance({
          totalBets: 20,
          wins: 12,
          losses: 8,
          accuracy: 0.6,
          roi: 0.25,
          profitLoss: 10.5,
        }),
      }),
    );

    expect(prompt).toContain("Total Bets: 20");
    expect(prompt).toContain("Wins: 12");
    expect(prompt).toContain("Losses: 8");
    expect(prompt).toContain("60.0%");
    expect(prompt).toContain("25.0%");
    expect(prompt).toContain("+10.50");
  });

  it("includes recent outcomes with win/loss indicators", () => {
    const prompt = buildFeedbackPrompt(
      makeInput({
        recentOutcomes: [
          makeOutcome({ result: "won", profit: 5.0 }),
          makeOutcome({ marketQuestion: "Will Man City win?", result: "lost", profit: -3.0 }),
        ],
      }),
    );

    expect(prompt).toContain("WIN");
    expect(prompt).toContain("LOSS");
    expect(prompt).toContain("+5.00");
    expect(prompt).toContain("-3.00");
    expect(prompt).toContain("Will Arsenal beat Chelsea?");
    expect(prompt).toContain("Will Man City win?");
  });

  it("includes leaderboard", () => {
    const prompt = buildFeedbackPrompt(
      makeInput({
        leaderboard: [
          makeLeaderboardEntry({ name: "Top Bot", profitLoss: 20.0 }),
          makeLeaderboardEntry({ name: "Mid Bot", profitLoss: 5.0 }),
          makeLeaderboardEntry({ name: "Low Bot", profitLoss: -3.0 }),
        ],
      }),
    );

    expect(prompt).toContain("Top Bot");
    expect(prompt).toContain("Mid Bot");
    expect(prompt).toContain("Low Bot");
    expect(prompt).toContain("Leaderboard");
    expect(prompt).toContain("Rank");
  });

  it("handles zero bets (new competitor)", () => {
    const prompt = buildFeedbackPrompt(
      makeInput({
        performance: makePerformance({
          totalBets: 0,
          wins: 0,
          losses: 0,
          accuracy: 0,
          roi: 0,
          profitLoss: 0,
        }),
        recentOutcomes: [],
      }),
    );

    expect(prompt).toContain("Total Bets: 0");
    expect(prompt).toContain("No predictions yet.");
  });

  it("handles all losses gracefully", () => {
    const outcomes = Array.from({ length: 5 }, (_, i) =>
      makeOutcome({
        marketQuestion: `Market ${i}`,
        result: "lost",
        profit: -2.0,
        side: "YES",
        confidence: 0.75,
      }),
    );

    const prompt = buildFeedbackPrompt(
      makeInput({
        performance: makePerformance({
          totalBets: 5,
          wins: 0,
          losses: 5,
          accuracy: 0,
          roi: -1,
          profitLoss: -10,
        }),
        recentOutcomes: outcomes,
      }),
    );

    expect(prompt).toContain("0.0%");
    expect(prompt).toContain("-10.00");
    expect(prompt).toContain("LOSS");
    expect(prompt).not.toContain("WIN");
  });

  it("truncates outcomes to last 20", () => {
    const outcomes = Array.from({ length: 30 }, (_, i) =>
      makeOutcome({ marketQuestion: `Market ${i}` }),
    );

    const prompt = buildFeedbackPrompt(makeInput({ recentOutcomes: outcomes }));

    // Should only include the last 20 (indices 10-29)
    expect(prompt).toContain("Market 10");
    expect(prompt).toContain("Market 29");
    expect(prompt).not.toContain("Market 9");
    expect(prompt).toContain("last 20");
  });

  it("suggests improvements for underperforming YES bets", () => {
    const outcomes = Array.from({ length: 5 }, () =>
      makeOutcome({ side: "YES", result: "lost", profit: -2.0 }),
    );

    const prompt = buildFeedbackPrompt(makeInput({ recentOutcomes: outcomes }));

    expect(prompt).toContain("YES bets are underperforming");
  });

  it("suggests improvements for high-confidence losses", () => {
    const outcomes = [
      makeOutcome({ confidence: 0.85, result: "lost", profit: -5 }),
      makeOutcome({ confidence: 0.9, result: "lost", profit: -5 }),
      makeOutcome({ confidence: 0.6, result: "won", profit: 3 }),
    ];

    const prompt = buildFeedbackPrompt(makeInput({ recentOutcomes: outcomes }));

    expect(prompt).toContain("high-confidence losses");
  });

  it("includes improvement instructions", () => {
    const prompt = buildFeedbackPrompt(makeInput());

    expect(prompt).toContain("confidence calibration");
    expect(prompt).toContain("stake sizing");
    expect(prompt).toContain("improved prediction engine");
  });
});
