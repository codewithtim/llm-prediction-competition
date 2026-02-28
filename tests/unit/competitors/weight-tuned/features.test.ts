import { describe, expect, it } from "bun:test";
import {
  clamp,
  extractFeatures,
  FEATURE_REGISTRY,
  type FeatureExtractor,
} from "../../../../src/competitors/weight-tuned/features";
import type { Statistics } from "../../../../src/domain/contracts/statistics";

function getFeature(name: string): FeatureExtractor {
  const fn = FEATURE_REGISTRY[name];
  if (!fn) throw new Error(`Feature ${name} not found in registry`);
  return fn;
}

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

describe("clamp", () => {
  it("returns value when within range", () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it("clamps to min when below", () => {
    expect(clamp(-0.5, 0, 1)).toBe(0);
  });

  it("clamps to max when above", () => {
    expect(clamp(1.5, 0, 1)).toBe(1);
  });
});

describe("feature extractors", () => {
  describe("homeWinRate", () => {
    it("returns correct home win rate", () => {
      const stats = makeStatistics();
      // homeRecord: played=10, wins=5 → 0.5
      expect(getFeature("homeWinRate")(stats)).toBe(0.5);
    });

    it("returns 0.5 for zero played", () => {
      const stats = makeStatistics({
        homeTeam: {
          ...makeStatistics().homeTeam,
          homeRecord: { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 },
        },
      });
      expect(getFeature("homeWinRate")(stats)).toBe(0.5);
    });
  });

  describe("awayLossRate", () => {
    it("returns correct away loss rate", () => {
      const stats = makeStatistics();
      // awayRecord: played=10, losses=2 → 0.2
      expect(getFeature("awayLossRate")(stats)).toBe(0.2);
    });

    it("returns 0.5 for zero played", () => {
      const stats = makeStatistics({
        awayTeam: {
          ...makeStatistics().awayTeam,
          awayRecord: { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 },
        },
      });
      expect(getFeature("awayLossRate")(stats)).toBe(0.5);
    });
  });

  describe("formDiff", () => {
    it("returns 1.0 when home has all wins and away all losses", () => {
      const stats = makeStatistics({
        homeTeam: { ...makeStatistics().homeTeam, form: "WWWWW" },
        awayTeam: { ...makeStatistics().awayTeam, form: "LLLLL" },
      });
      expect(getFeature("formDiff")(stats)).toBe(1.0);
    });

    it("returns 0.0 when home has all losses and away all wins", () => {
      const stats = makeStatistics({
        homeTeam: { ...makeStatistics().homeTeam, form: "LLLLL" },
        awayTeam: { ...makeStatistics().awayTeam, form: "WWWWW" },
      });
      expect(getFeature("formDiff")(stats)).toBe(0.0);
    });

    it("returns 0.5 when forms are equal", () => {
      const stats = makeStatistics({
        homeTeam: { ...makeStatistics().homeTeam, form: "WWDLL" },
        awayTeam: { ...makeStatistics().awayTeam, form: "WWDLL" },
      });
      expect(getFeature("formDiff")(stats)).toBe(0.5);
    });

    it("handles null form gracefully", () => {
      const stats = makeStatistics({
        homeTeam: { ...makeStatistics().homeTeam, form: null },
        awayTeam: { ...makeStatistics().awayTeam, form: null },
      });
      expect(getFeature("formDiff")(stats)).toBe(0.5);
    });
  });

  describe("h2h", () => {
    it("returns correct ratio", () => {
      const stats = makeStatistics();
      // totalMatches: 5, homeWins: 3 → 0.6
      expect(getFeature("h2h")(stats)).toBe(0.6);
    });

    it("returns 0.5 for zero matches", () => {
      const stats = makeStatistics({
        h2h: { totalMatches: 0, homeWins: 0, awayWins: 0, draws: 0, recentMatches: [] },
      });
      expect(getFeature("h2h")(stats)).toBe(0.5);
    });
  });

  describe("goalDiff", () => {
    it("returns value in [0, 1]", () => {
      const stats = makeStatistics();
      const value = getFeature("goalDiff")(stats);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });

    it("returns 0.5 when both teams have zero played", () => {
      const zeroTeam = {
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
        homeRecord: { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 },
        awayRecord: { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 },
      };
      const stats = makeStatistics({
        homeTeam: { ...zeroTeam, teamName: "Home FC" },
        awayTeam: { ...zeroTeam, teamId: 2, teamName: "Away FC" },
      });
      expect(getFeature("goalDiff")(stats)).toBe(0.5);
    });
  });

  describe("pointsPerGame", () => {
    it("returns value in [0, 1]", () => {
      const stats = makeStatistics();
      const value = getFeature("pointsPerGame")(stats);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });

    it("returns > 0.5 when home has more points per game", () => {
      const stats = makeStatistics();
      // home: 41/20 = 2.05 ppg, away: 34/20 = 1.7 ppg → home better
      expect(getFeature("pointsPerGame")(stats)).toBeGreaterThan(0.5);
    });
  });

  describe("defensiveStrength", () => {
    it("returns value in [0, 1]", () => {
      const stats = makeStatistics();
      const value = getFeature("defensiveStrength")(stats);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });
  });
});

describe("extractFeatures", () => {
  it("returns all 7 features", () => {
    const features = extractFeatures(makeStatistics());
    expect(Object.keys(features)).toHaveLength(7);
    expect(features.homeWinRate).toBeDefined();
    expect(features.awayLossRate).toBeDefined();
    expect(features.formDiff).toBeDefined();
    expect(features.h2h).toBeDefined();
    expect(features.goalDiff).toBeDefined();
    expect(features.pointsPerGame).toBeDefined();
    expect(features.defensiveStrength).toBeDefined();
  });

  it("all features are in [0, 1]", () => {
    const features = extractFeatures(makeStatistics());
    for (const [, value] of Object.entries(features)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("works with unbalanced teams", () => {
    const stats = makeStatistics({
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
    });

    const features = extractFeatures(stats);
    // Strong home team should produce high values
    expect(features.homeWinRate).toBeGreaterThan(0.7);
    expect(features.formDiff).toBeGreaterThan(0.7);
    expect(features.goalDiff).toBeGreaterThan(0.7);
    expect(features.awayLossRate).toBeGreaterThan(0.7);
  });
});
