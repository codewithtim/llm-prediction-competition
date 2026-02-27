import { describe, expect, it } from "bun:test";
import {
  BASELINE_ID,
  BASELINE_NAME,
  baselineEngine,
  computeFormAdvantage,
  computeH2hAdvantage,
  computeHomeWinRate,
  computeStake,
  parseForm,
} from "../../../../src/competitors/baseline/engine";
import { CompetitorRegistry } from "../../../../src/competitors/registry";
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
    market: {
      marketId: "market-123",
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

describe("baseline engine", () => {
  describe("contract compliance", () => {
    it("returns valid PredictionOutput that passes validatePredictions", () => {
      const predictions = baselineEngine(makeStatistics());
      const { valid, errors } = validatePredictions(predictions);
      expect(errors).toHaveLength(0);
      expect(valid).toHaveLength(1);
    });

    it("returns exactly one prediction", () => {
      const predictions = baselineEngine(makeStatistics());
      expect(predictions).toHaveLength(1);
    });

    it("uses the market's marketId", () => {
      const stats = makeStatistics({
        market: {
          marketId: "my-special-market",
          question: "Will team win?",
          currentYesPrice: 0.5,
          currentNoPrice: 0.5,
          liquidity: 1000,
          volume: 5000,
          sportsMarketType: "winner",
          line: null,
        },
      });
      const predictions = baselineEngine(stats);
      expect(predictions[0]?.marketId).toBe("my-special-market");
    });

    it("side is YES or NO", () => {
      const predictions = baselineEngine(makeStatistics());
      // biome-ignore lint/style/noNonNullAssertion: test assertion after length check
      expect(["YES", "NO"]).toContain(predictions[0]!.side);
    });

    it("confidence is between 0 and 1", () => {
      const predictions = baselineEngine(makeStatistics());
      expect(predictions[0]?.confidence).toBeGreaterThanOrEqual(0);
      expect(predictions[0]?.confidence).toBeLessThanOrEqual(1);
    });

    it("stake is positive", () => {
      const predictions = baselineEngine(makeStatistics());
      expect(predictions[0]?.stake).toBeGreaterThan(0);
    });

    it("reasoning is non-empty and under 500 chars", () => {
      const predictions = baselineEngine(makeStatistics());
      expect(predictions[0]?.reasoning.length).toBeGreaterThan(0);
      expect(predictions[0]?.reasoning.length).toBeLessThan(500);
    });

    it("passes through runEngine without error", async () => {
      const registered = {
        competitorId: BASELINE_ID,
        name: BASELINE_NAME,
        engine: baselineEngine,
      };
      const result = await runEngine(registered, makeStatistics());
      expect("predictions" in result).toBe(true);
      if ("predictions" in result) {
        expect(result.predictions).toHaveLength(1);
      }
    });
  });

  describe("heuristic logic", () => {
    it("strong home team produces YES with high confidence", () => {
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
        h2h: {
          totalMatches: 4,
          homeWins: 4,
          awayWins: 0,
          draws: 0,
          recentMatches: [],
        },
      });
      const predictions = baselineEngine(stats);
      expect(predictions[0]?.side).toBe("YES");
      expect(predictions[0]?.confidence).toBeGreaterThan(0.7);
    });

    it("weak home team produces NO", () => {
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
        h2h: {
          totalMatches: 4,
          homeWins: 0,
          awayWins: 4,
          draws: 0,
          recentMatches: [],
        },
      });
      const predictions = baselineEngine(stats);
      expect(predictions[0]?.side).toBe("NO");
    });

    it("confidence is always >= 0.5", () => {
      // Even for balanced teams, confidence should be >= 0.5
      const stats = makeStatistics();
      const predictions = baselineEngine(stats);
      expect(predictions[0]?.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it("handles null form gracefully", () => {
      const stats = makeStatistics({
        homeTeam: {
          ...makeStatistics().homeTeam,
          form: null,
        },
        awayTeam: {
          ...makeStatistics().awayTeam,
          form: null,
        },
      });
      const predictions = baselineEngine(stats);
      expect(predictions).toHaveLength(1);
      expect(predictions[0]?.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it("handles zero played games without crashing", () => {
      const zeroRecord = { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };
      const stats = makeStatistics({
        homeTeam: {
          teamId: 1,
          teamName: "New FC",
          played: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          goalDifference: 0,
          points: 0,
          form: null,
          homeRecord: zeroRecord,
          awayRecord: zeroRecord,
        },
      });
      const predictions = baselineEngine(stats);
      expect(predictions).toHaveLength(1);
      expect(predictions[0]?.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it("handles zero H2H matches with neutral default", () => {
      const stats = makeStatistics({
        h2h: {
          totalMatches: 0,
          homeWins: 0,
          awayWins: 0,
          draws: 0,
          recentMatches: [],
        },
      });
      const predictions = baselineEngine(stats);
      expect(predictions).toHaveLength(1);
      expect(predictions[0]?.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it("stake scales with confidence", () => {
      // Strong home team → higher confidence → higher stake
      const strongStats = makeStatistics({
        homeTeam: {
          teamId: 1,
          teamName: "Strong FC",
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
      });
      const balancedStats = makeStatistics();
      const strongPred = baselineEngine(strongStats);
      const balancedPred = baselineEngine(balancedStats);
      // biome-ignore lint/style/noNonNullAssertion: test assertion after length check
      expect(strongPred[0]?.stake).toBeGreaterThan(balancedPred[0]!.stake);
    });

    it("stake is at least 1", () => {
      const predictions = baselineEngine(makeStatistics());
      expect(predictions[0]?.stake).toBeGreaterThanOrEqual(1);
    });
  });

  describe("registration", () => {
    it("can be registered in CompetitorRegistry and retrieved", () => {
      const registry = new CompetitorRegistry();
      registry.register(BASELINE_ID, BASELINE_NAME, baselineEngine);
      const retrieved = registry.get(BASELINE_ID);
      expect(retrieved).toBeDefined();
      expect(retrieved?.competitorId).toBe(BASELINE_ID);
      expect(retrieved?.name).toBe(BASELINE_NAME);
      expect(retrieved?.engine).toBe(baselineEngine);
    });
  });
});

describe("helper functions", () => {
  describe("parseForm", () => {
    it("parses WWWWW as 1.0", () => {
      expect(parseForm("WWWWW")).toBe(1.0);
    });

    it("parses LLLLL as 0.0", () => {
      expect(parseForm("LLLLL")).toBe(0.0);
    });

    it("parses DDDDD as 0.5", () => {
      expect(parseForm("DDDDD")).toBe(0.5);
    });

    it("parses mixed form correctly", () => {
      // WWDLW: W=1, W=1, D=0.5, L=0, W=1 → 3.5/5 = 0.7
      expect(parseForm("WWDLW")).toBe(0.7);
    });

    it("returns 0.5 for null form", () => {
      expect(parseForm(null)).toBe(0.5);
    });

    it("returns 0.5 for empty string", () => {
      expect(parseForm("")).toBe(0.5);
    });
  });

  describe("computeHomeWinRate", () => {
    it("returns correct rate for home record", () => {
      const team = makeStatistics().homeTeam;
      // homeRecord: played=10, wins=5 → 0.5
      expect(computeHomeWinRate(team)).toBe(0.5);
    });

    it("returns 0.5 for zero played", () => {
      const team = {
        ...makeStatistics().homeTeam,
        homeRecord: { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 },
      };
      expect(computeHomeWinRate(team)).toBe(0.5);
    });
  });

  describe("computeFormAdvantage", () => {
    it("returns 1.0 when home has all wins and away all losses", () => {
      const home = { ...makeStatistics().homeTeam, form: "WWWWW" };
      const away = { ...makeStatistics().awayTeam, form: "LLLLL" };
      expect(computeFormAdvantage(home, away)).toBe(1.0);
    });

    it("returns 0.0 when home has all losses and away all wins", () => {
      const home = { ...makeStatistics().homeTeam, form: "LLLLL" };
      const away = { ...makeStatistics().awayTeam, form: "WWWWW" };
      expect(computeFormAdvantage(home, away)).toBe(0.0);
    });

    it("returns 0.5 when forms are equal", () => {
      const home = { ...makeStatistics().homeTeam, form: "WWDLL" };
      const away = { ...makeStatistics().awayTeam, form: "WWDLL" };
      expect(computeFormAdvantage(home, away)).toBe(0.5);
    });
  });

  describe("computeH2hAdvantage", () => {
    it("returns correct ratio", () => {
      expect(
        computeH2hAdvantage({
          totalMatches: 10,
          homeWins: 7,
          awayWins: 2,
          draws: 1,
          recentMatches: [],
        }),
      ).toBe(0.7);
    });

    it("returns 0.5 for zero matches", () => {
      expect(
        computeH2hAdvantage({
          totalMatches: 0,
          homeWins: 0,
          awayWins: 0,
          draws: 0,
          recentMatches: [],
        }),
      ).toBe(0.5);
    });
  });

  describe("computeStake", () => {
    it("returns 1 for confidence 0.5", () => {
      expect(computeStake(0.5)).toBe(1);
    });

    it("returns 10 for confidence 1.0", () => {
      expect(computeStake(1.0)).toBe(10);
    });

    it("returns at least 1 for any confidence", () => {
      expect(computeStake(0.3)).toBeGreaterThanOrEqual(1);
    });
  });
});
