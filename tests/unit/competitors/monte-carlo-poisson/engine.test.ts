import { describe, expect, it } from "bun:test";
import { createMonteCarloEngine } from "../../../../src/competitors/monte-carlo-poisson/engine";
import type { PredictionOutput } from "../../../../src/domain/contracts/prediction";
import type { Statistics } from "../../../../src/domain/contracts/statistics";
import { validatePredictions } from "../../../../src/engine/validator";

const record = { played: 10, wins: 5, draws: 3, losses: 2, goalsFor: 15, goalsAgainst: 12 };

function makeStats(overrides?: Partial<Statistics>): Statistics {
  return {
    fixtureId: 1,
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
      homeRecord: { played: 10, wins: 8, draws: 1, losses: 1, goalsFor: 22, goalsAgainst: 5 },
      awayRecord: record,
    },
    awayTeam: {
      teamId: 2,
      teamName: "Chelsea",
      played: 20,
      wins: 6,
      draws: 4,
      losses: 10,
      goalsFor: 18,
      goalsAgainst: 30,
      goalDifference: -12,
      points: 22,
      form: "LDLWL",
      homeRecord: record,
      awayRecord: { played: 10, wins: 2, draws: 2, losses: 6, goalsFor: 8, goalsAgainst: 20 },
    },
    h2h: { totalMatches: 2, homeWins: 1, awayWins: 0, draws: 1, recentMatches: [] },
    markets: [
      {
        marketId: "market-1",
        question: "Will Arsenal win?",
        currentYesPrice: 0.5,
        currentNoPrice: 0.5,
        liquidity: 10000,
        volume: 50000,
        sportsMarketType: "winner",
        line: null,
      },
    ],
    ...overrides,
  };
}

describe("createMonteCarloEngine", () => {
  it("returns valid PredictionOutput that passes validation", () => {
    const engine = createMonteCarloEngine();
    const predictions = engine(makeStats()) as PredictionOutput[];
    const { valid, errors } = validatePredictions(predictions);
    expect(errors).toHaveLength(0);
    expect(valid.length).toBeGreaterThanOrEqual(0);
  });

  it("returns empty array when edge is below minEdge", () => {
    const engine = createMonteCarloEngine({ minEdge: 0.99 });
    const predictions = engine(makeStats()) as PredictionOutput[];
    expect(predictions).toHaveLength(0);
  });

  it("bets YES when model probability exceeds market price", () => {
    const stats = makeStats({
      markets: [
        {
          marketId: "m1",
          question: "Will Arsenal win?",
          currentYesPrice: 0.3,
          currentNoPrice: 0.7,
          liquidity: 10000,
          volume: 50000,
          sportsMarketType: "winner",
          line: null,
        },
      ],
    });
    const engine = createMonteCarloEngine({ minEdge: 0.01 });
    const predictions = engine(stats) as PredictionOutput[];
    expect(predictions.length).toBeGreaterThan(0);
    expect(predictions[0]?.side).toBe("YES");
  });

  it("stake is within configured range", () => {
    const engine = createMonteCarloEngine({ minEdge: 0.01, maxBetPct: 0.08, minBetPct: 0.002 });
    const predictions = engine(makeStats()) as PredictionOutput[];
    if (predictions.length > 0) {
      expect(predictions[0]!.stake).toBeGreaterThanOrEqual(0.002);
      expect(predictions[0]!.stake).toBeLessThanOrEqual(0.08);
    }
  });

  it("higher edge produces larger stake", () => {
    const smallEdgeStats = makeStats({
      markets: [
        {
          marketId: "m1",
          question: "Will Arsenal win?",
          currentYesPrice: 0.48,
          currentNoPrice: 0.52,
          liquidity: 10000,
          volume: 50000,
          sportsMarketType: "winner",
          line: null,
        },
      ],
    });
    const bigEdgeStats = makeStats({
      markets: [
        {
          marketId: "m1",
          question: "Will Arsenal win?",
          currentYesPrice: 0.2,
          currentNoPrice: 0.8,
          liquidity: 10000,
          volume: 50000,
          sportsMarketType: "winner",
          line: null,
        },
      ],
    });
    const engine = createMonteCarloEngine({ minEdge: 0.01 });
    const small = engine(smallEdgeStats) as PredictionOutput[];
    const big = engine(bigEdgeStats) as PredictionOutput[];
    if (small.length > 0 && big.length > 0) {
      expect(big[0]!.stake).toBeGreaterThanOrEqual(small[0]!.stake);
    }
  });

  it("handles missing optional data gracefully", () => {
    const stats = makeStats();
    // No injuries, no season stats, no player stats
    const engine = createMonteCarloEngine({ minEdge: 0.01 });
    const predictions = engine(stats) as PredictionOutput[];
    const { errors } = validatePredictions(predictions);
    expect(errors).toHaveLength(0);
  });

  it("reasoning includes simulation details", () => {
    const engine = createMonteCarloEngine({ minEdge: 0.01 });
    const predictions = engine(makeStats()) as PredictionOutput[];
    if (predictions.length > 0) {
      const reasoning = predictions[0]!.reasoning;
      expect(reasoning.summary).toContain("MC-Poisson");
      expect(reasoning.sections.some((s) => s.label === "Simulation")).toBe(true);
      expect(reasoning.sections.some((s) => s.label === "Lambda")).toBe(true);
      expect(reasoning.sections.some((s) => s.label === "Edge")).toBe(true);
    }
  });

  it("extractedFeatures contains lambda and probability values", () => {
    const engine = createMonteCarloEngine({ minEdge: 0.01 });
    const predictions = engine(makeStats()) as PredictionOutput[];
    if (predictions.length > 0) {
      const features = predictions[0]!.extractedFeatures!;
      expect(features.lambdaHome).toBeDefined();
      expect(features.lambdaAway).toBeDefined();
      expect(features.homeWinPct).toBeDefined();
      expect(features.drawPct).toBeDefined();
      expect(features.awayWinPct).toBeDefined();
    }
  });
});
