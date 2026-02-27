import { describe, expect, it } from "bun:test";
import type { PredictionOutput } from "../../../src/domain/contracts/prediction";
import type { Statistics } from "../../../src/domain/contracts/statistics";
import { runAllEngines, runEngine } from "../../../src/engine/runner";
import type { RegisteredEngine } from "../../../src/engine/types";

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
    market: {
      marketId: "market-1",
      question: "Will Arsenal win?",
      currentYesPrice: 0.65,
      currentNoPrice: 0.35,
      liquidity: 10000,
      volume: 50000,
      sportsMarketType: "winner",
      line: null,
    },
    ...overrides,
  };
}

function makeRegisteredEngine(overrides?: Partial<RegisteredEngine>): RegisteredEngine {
  return {
    competitorId: "test-engine",
    name: "Test Engine",
    engine: () => [
      {
        marketId: "market-1",
        side: "YES" as const,
        confidence: 0.8,
        stake: 10,
        reasoning: "Test reasoning for prediction",
      },
    ],
    ...overrides,
  };
}

describe("runEngine", () => {
  it("returns EngineResult for valid predictions", async () => {
    const result = await runEngine(makeRegisteredEngine(), makeStatistics());
    expect(result.competitorId).toBe("test-engine");
    expect("predictions" in result).toBe(true);
    if ("predictions" in result) {
      expect(result.predictions).toHaveLength(1);
      expect(result.predictions[0]?.marketId).toBe("market-1");
    }
  });

  it("returns EngineError for invalid output", async () => {
    const engine = makeRegisteredEngine({
      engine: () =>
        [
          { marketId: "m1", side: "MAYBE", confidence: 0.5, stake: 5, reasoning: "Bad" },
        ] as unknown as PredictionOutput[],
    });
    const result = await runEngine(engine, makeStatistics());
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("Validation failed");
    }
  });

  it("returns EngineError when engine throws", async () => {
    const engine = makeRegisteredEngine({
      engine: () => {
        throw new Error("Engine exploded");
      },
    });
    const result = await runEngine(engine, makeStatistics());
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("Engine exploded");
    }
  });

  it("returns EngineError for non-array return", async () => {
    const engine = makeRegisteredEngine({
      engine: () => "not an array" as unknown as PredictionOutput[],
    });
    const result = await runEngine(engine, makeStatistics());
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("Validation failed");
    }
  });

  it("resolves async engine correctly", async () => {
    const engine = makeRegisteredEngine({
      engine: async () => [
        {
          marketId: "market-1",
          side: "NO" as const,
          confidence: 0.6,
          stake: 3,
          reasoning: "Async prediction reasoning",
        },
      ],
    });
    const result = await runEngine(engine, makeStatistics());
    expect("predictions" in result).toBe(true);
    if ("predictions" in result) {
      expect(result.predictions).toHaveLength(1);
      expect(result.predictions[0]?.side).toBe("NO");
    }
  });
});

describe("runAllEngines", () => {
  it("returns results for multiple successful engines", async () => {
    const engines = [
      makeRegisteredEngine({ competitorId: "engine-1", name: "Engine 1" }),
      makeRegisteredEngine({ competitorId: "engine-2", name: "Engine 2" }),
    ];
    const results = await runAllEngines(engines, makeStatistics());
    expect(results).toHaveLength(2);
    expect(results[0]?.competitorId).toBe("engine-1");
    expect(results[1]?.competitorId).toBe("engine-2");
    expect("predictions" in (results[0] ?? {})).toBe(true);
    expect("predictions" in (results[1] ?? {})).toBe(true);
  });

  it("returns mix of EngineResult and EngineError", async () => {
    const engines = [
      makeRegisteredEngine({ competitorId: "good" }),
      makeRegisteredEngine({
        competitorId: "bad",
        engine: () => {
          throw new Error("Broke");
        },
      }),
    ];
    const results = await runAllEngines(engines, makeStatistics());
    expect(results).toHaveLength(2);
    expect("predictions" in (results[0] ?? {})).toBe(true);
    expect("error" in (results[1] ?? {})).toBe(true);
  });

  it("returns empty array for no engines", async () => {
    const results = await runAllEngines([], makeStatistics());
    expect(results).toHaveLength(0);
  });
});
