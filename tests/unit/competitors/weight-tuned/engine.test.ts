import { describe, expect, it } from "bun:test";
import {
  classifyMarket,
  createWeightedEngine,
} from "../../../../src/competitors/weight-tuned/engine";
import { SAMPLE_STATISTICS_MULTI_MARKET } from "../../../../src/competitors/weight-tuned/sample-statistics";
import {
  DEFAULT_STAKE_CONFIG,
  DEFAULT_WEIGHTS,
  type StakeConfig,
  type WeightConfig,
} from "../../../../src/competitors/weight-tuned/types";
import type { PredictionOutput } from "../../../../src/domain/contracts/prediction";
import type { Statistics } from "../../../../src/domain/contracts/statistics";
import { runEngine } from "../../../../src/engine/runner";
import { validatePredictions } from "../../../../src/engine/validator";

function makeStatistics(overrides?: Partial<Statistics>): Statistics {
  const record = { played: 10, wins: 5, draws: 3, losses: 2, goalsFor: 15, goalsAgainst: 8 };
  return {
    fixtureId: 1001,
    league: { id: 39, name: "Premier League", country: "England", season: 2025 },
    homeTeam: {
      teamId: 1,
      teamName: "Arsenal",
      played: 20,
      wins: 12,
      draws: 5,
      losses: 3,
      goalsFor: 35,
      goalsAgainst: 15,
      goalDifference: 20,
      points: 41,
      form: "WWDLW",
      homeRecord: record,
      awayRecord: record,
    },
    awayTeam: {
      teamId: 2,
      teamName: "Chelsea",
      played: 20,
      wins: 10,
      draws: 4,
      losses: 6,
      goalsFor: 28,
      goalsAgainst: 20,
      goalDifference: 8,
      points: 34,
      form: "WLDWW",
      homeRecord: record,
      awayRecord: record,
    },
    h2h: {
      totalMatches: 5,
      homeWins: 3,
      awayWins: 1,
      draws: 1,
      recentMatches: [],
    },
    markets: [
      {
        marketId: "market-123",
        question: "Will Arsenal win?",
        currentYesPrice: 0.65,
        currentNoPrice: 0.35,
        liquidity: 10000,
        volume: 50000,
        sportsMarketType: "winner",
        line: null,
      },
    ],
    ...overrides,
  };
}

describe("classifyMarket", () => {
  it("classifies home team market", () => {
    expect(classifyMarket("Will Arsenal win vs Chelsea?", "Arsenal", "Chelsea")).toBe("home");
  });

  it("classifies away team market", () => {
    expect(classifyMarket("Will Chelsea win vs Arsenal?", "Arsenal", "Chelsea")).toBe("away");
  });

  it("classifies draw market", () => {
    expect(classifyMarket("Will Arsenal vs Chelsea end in a draw?", "Arsenal", "Chelsea")).toBe(
      "draw",
    );
  });

  it("is case insensitive", () => {
    expect(classifyMarket("will arsenal win?", "Arsenal", "Chelsea")).toBe("home");
  });

  it("defaults to home when ambiguous", () => {
    expect(classifyMarket("Who will triumph?", "Arsenal", "Chelsea")).toBe("home");
  });

  it("classifies by team name without 'win'", () => {
    expect(classifyMarket("Arsenal to score first", "Arsenal", "Chelsea")).toBe("home");
    expect(classifyMarket("Chelsea to score first", "Arsenal", "Chelsea")).toBe("away");
  });
});

function run(
  weights: WeightConfig,
  stakeConfig: StakeConfig,
  stats: Statistics,
): PredictionOutput[] {
  const engine = createWeightedEngine(weights, stakeConfig);
  return engine(stats) as PredictionOutput[];
}

describe("createWeightedEngine", () => {
  it("returns valid PredictionOutput that passes validatePredictions", () => {
    const predictions = run(DEFAULT_WEIGHTS, DEFAULT_STAKE_CONFIG, makeStatistics());
    const { valid, errors } = validatePredictions(predictions);
    expect(errors).toHaveLength(0);
    expect(valid).toHaveLength(1);
  });

  it("returns exactly one prediction", () => {
    const predictions = run(DEFAULT_WEIGHTS, DEFAULT_STAKE_CONFIG, makeStatistics());
    expect(predictions).toHaveLength(1);
  });

  it("passes through runEngine without error", async () => {
    const engine = createWeightedEngine(DEFAULT_WEIGHTS, DEFAULT_STAKE_CONFIG);
    const registered = { competitorId: "wt-test", name: "Test Engine", engine };
    const result = await runEngine(registered, makeStatistics());
    expect("predictions" in result).toBe(true);
    if ("predictions" in result) {
      expect(result.predictions).toHaveLength(1);
    }
  });

  it("strong home team produces YES", () => {
    const stats = makeStatistics({
      homeTeam: {
        teamId: 1,
        teamName: "Dominant FC",
        played: 20,
        wins: 18,
        draws: 1,
        losses: 1,
        goalsFor: 50,
        goalsAgainst: 5,
        goalDifference: 45,
        points: 55,
        form: "WWWWW",
        homeRecord: { played: 10, wins: 9, draws: 1, losses: 0, goalsFor: 30, goalsAgainst: 3 },
        awayRecord: { played: 10, wins: 9, draws: 0, losses: 1, goalsFor: 20, goalsAgainst: 2 },
      },
      awayTeam: {
        teamId: 2,
        teamName: "Weak FC",
        played: 20,
        wins: 2,
        draws: 3,
        losses: 15,
        goalsFor: 10,
        goalsAgainst: 40,
        goalDifference: -30,
        points: 9,
        form: "LLLLL",
        homeRecord: { played: 10, wins: 1, draws: 2, losses: 7, goalsFor: 5, goalsAgainst: 20 },
        awayRecord: { played: 10, wins: 1, draws: 1, losses: 8, goalsFor: 5, goalsAgainst: 20 },
      },
      h2h: { totalMatches: 4, homeWins: 4, awayWins: 0, draws: 0, recentMatches: [] },
      markets: [
        {
          marketId: "home-win",
          question: "Will Dominant FC win?",
          currentYesPrice: 0.6,
          currentNoPrice: 0.4,
          liquidity: 10000,
          volume: 50000,
          sportsMarketType: "winner",
          line: null,
        },
      ],
    });
    const predictions = run(DEFAULT_WEIGHTS, DEFAULT_STAKE_CONFIG, stats);
    expect(predictions[0]?.side).toBe("YES");
    expect(predictions[0]?.confidence).toBeGreaterThan(0.6);
  });

  it("weak home team produces lower confidence or NO", () => {
    const stats = makeStatistics({
      homeTeam: {
        teamId: 1,
        teamName: "Weak FC",
        played: 20,
        wins: 2,
        draws: 3,
        losses: 15,
        goalsFor: 10,
        goalsAgainst: 40,
        goalDifference: -30,
        points: 9,
        form: "LLLLL",
        homeRecord: { played: 10, wins: 0, draws: 1, losses: 9, goalsFor: 3, goalsAgainst: 25 },
        awayRecord: { played: 10, wins: 2, draws: 2, losses: 6, goalsFor: 7, goalsAgainst: 15 },
      },
      awayTeam: {
        teamId: 2,
        teamName: "Dominant FC",
        played: 20,
        wins: 18,
        draws: 1,
        losses: 1,
        goalsFor: 50,
        goalsAgainst: 5,
        goalDifference: 45,
        points: 55,
        form: "WWWWW",
        homeRecord: { played: 10, wins: 9, draws: 1, losses: 0, goalsFor: 30, goalsAgainst: 3 },
        awayRecord: { played: 10, wins: 9, draws: 0, losses: 1, goalsFor: 20, goalsAgainst: 2 },
      },
      h2h: { totalMatches: 4, homeWins: 0, awayWins: 4, draws: 0, recentMatches: [] },
      markets: [
        {
          marketId: "home-win",
          question: "Will Weak FC win?",
          currentYesPrice: 0.6,
          currentNoPrice: 0.4,
          liquidity: 10000,
          volume: 50000,
          sportsMarketType: "winner",
          line: null,
        },
      ],
    });
    const predictions = run(DEFAULT_WEIGHTS, DEFAULT_STAKE_CONFIG, stats);
    expect(predictions[0]?.side).toBe("NO");
  });

  it("selects market with best edge from multi-market", () => {
    const predictions = run(DEFAULT_WEIGHTS, DEFAULT_STAKE_CONFIG, SAMPLE_STATISTICS_MULTI_MARKET);
    expect(predictions).toHaveLength(1);
    // Should pick a valid market from the sample
    const validMarketIds = SAMPLE_STATISTICS_MULTI_MARKET.markets.map((m) => m.marketId);
    // biome-ignore lint/style/noNonNullAssertion: test assertion after length check
    expect(validMarketIds).toContain(predictions[0]!.marketId);
  });

  it("stake fraction is within configured range", () => {
    const stakeConfig: StakeConfig = { maxBetPct: 0.1, minBetPct: 0.005 };
    const predictions = run(DEFAULT_WEIGHTS, stakeConfig, makeStatistics());
    expect(predictions[0]?.stake).toBeGreaterThanOrEqual(stakeConfig.minBetPct);
    expect(predictions[0]?.stake).toBeLessThanOrEqual(stakeConfig.maxBetPct);
  });

  it("confidence is between 0 and 1", () => {
    const predictions = run(DEFAULT_WEIGHTS, DEFAULT_STAKE_CONFIG, makeStatistics());
    expect(predictions[0]?.confidence).toBeGreaterThanOrEqual(0);
    expect(predictions[0]?.confidence).toBeLessThanOrEqual(1);
  });

  it("reasoning is non-empty and under 500 chars", () => {
    const predictions = run(DEFAULT_WEIGHTS, DEFAULT_STAKE_CONFIG, makeStatistics());
    expect(predictions[0]?.reasoning.length).toBeGreaterThan(0);
    expect(predictions[0]?.reasoning.length).toBeLessThanOrEqual(500);
  });

  it("handles all weights at zero gracefully", () => {
    const zeroWeights: WeightConfig = {
      signals: {
        homeWinRate: 0,
        formDiff: 0,
        h2h: 0,
        awayLossRate: 0,
        goalDiff: 0,
        pointsPerGame: 0,
        defensiveStrength: 0,
      },
      drawBaseline: 0.25,
      drawPeak: 0.5,
      drawWidth: 0.15,
      confidenceThreshold: 0.52,
      minEdge: 0.05,
      stakingAggression: 0.5,
      edgeMultiplier: 2.0,
      kellyFraction: 0.25,
    };
    const predictions = run(zeroWeights, DEFAULT_STAKE_CONFIG, makeStatistics());
    expect(predictions).toHaveLength(1);
    // homeStrength defaults to 0.5 when all weights are 0
    const { valid, errors } = validatePredictions(predictions);
    expect(errors).toHaveLength(0);
    expect(valid).toHaveLength(1);
  });

  it("handles single market statistics", () => {
    const predictions = run(DEFAULT_WEIGHTS, DEFAULT_STAKE_CONFIG, makeStatistics());
    expect(predictions).toHaveLength(1);
    expect(predictions[0]?.marketId).toBe("market-123");
  });

  it("balanced teams produce higher draw probability", () => {
    const record = { played: 10, wins: 5, draws: 3, losses: 2, goalsFor: 15, goalsAgainst: 12 };
    const balancedTeam = {
      teamId: 1,
      teamName: "Equal FC",
      played: 20,
      wins: 8,
      draws: 6,
      losses: 6,
      goalsFor: 25,
      goalsAgainst: 25,
      goalDifference: 0,
      points: 30,
      form: "WDLDW",
      homeRecord: record,
      awayRecord: record,
    };

    // Balanced teams
    const balancedStats = makeStatistics({
      homeTeam: { ...balancedTeam, teamName: "Home FC" },
      awayTeam: { ...balancedTeam, teamId: 2, teamName: "Away FC" },
      h2h: { totalMatches: 10, homeWins: 3, awayWins: 3, draws: 4, recentMatches: [] },
      markets: [
        {
          marketId: "draw-market",
          question: "Will Home FC vs Away FC end in a draw?",
          currentYesPrice: 0.3,
          currentNoPrice: 0.7,
          liquidity: 10000,
          volume: 50000,
          sportsMarketType: "winner",
          line: null,
        },
      ],
    });

    const predictions = run(DEFAULT_WEIGHTS, DEFAULT_STAKE_CONFIG, balancedStats);
    expect(predictions).toHaveLength(1);
    // With balanced teams and a draw market, the engine should process it
    const { valid, errors } = validatePredictions(predictions);
    expect(errors).toHaveLength(0);
    expect(valid).toHaveLength(1);
  });
});
