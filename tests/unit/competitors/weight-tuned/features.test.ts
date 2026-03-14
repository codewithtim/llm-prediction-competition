import { describe, expect, it } from "bun:test";
import {
  clamp,
  extractFeatures,
  FEATURE_NAMES,
  FEATURE_REGISTRY,
  type FeatureEntry,
  getMissingSignals,
} from "../../../../src/competitors/weight-tuned/features";
import type {
  PlayerSeasonStats,
  Statistics,
  TeamSeasonStats,
} from "../../../../src/domain/contracts/statistics";

function getFeature(name: string): FeatureEntry {
  const entry = FEATURE_REGISTRY[name];
  if (!entry) throw new Error(`Feature ${name} not found in registry`);
  return entry;
}

function makePlayerStats(overrides?: Partial<PlayerSeasonStats>): PlayerSeasonStats {
  return {
    playerId: 1,
    name: "Test Player",
    position: "MF",
    rating: 7.0,
    appearances: 20,
    minutes: 1500,
    goals: 5,
    assists: 3,
    shotsTotal: 30,
    shotsOnTarget: 12,
    passesKey: 20,
    passAccuracy: 80,
    dribblesSuccess: 10,
    dribblesAttempts: 20,
    yellowCards: 2,
    redCards: 0,
    injured: false,
    ...overrides,
  };
}

function makeSeasonStats(overrides?: Partial<TeamSeasonStats>): TeamSeasonStats {
  return {
    form: "WWDLW",
    fixtures: { played: { home: 10, away: 10, total: 20 } },
    cleanSheets: { home: 5, away: 3, total: 8 },
    failedToScore: { home: 2, away: 3, total: 5 },
    biggestStreak: { wins: 4, draws: 2, loses: 1 },
    penaltyRecord: { scored: 3, missed: 1, total: 4 },
    preferredFormations: [{ formation: "4-3-3", played: 15 }],
    goalsForByMinute: {
      "0-15": { total: 4, percentage: "12.5%" },
      "16-30": { total: 5, percentage: "15.6%" },
      "31-45": { total: 5, percentage: "15.6%" },
      "46-60": { total: 6, percentage: "18.8%" },
      "61-75": { total: 5, percentage: "15.6%" },
      "76-90": { total: 4, percentage: "12.5%" },
      "91-105": { total: 3, percentage: "9.4%" },
      "106-120": { total: null, percentage: null },
    },
    goalsAgainstByMinute: {
      "0-15": { total: 2, percentage: "13.3%" },
      "16-30": { total: 2, percentage: "13.3%" },
      "31-45": { total: 3, percentage: "20.0%" },
      "46-60": { total: 3, percentage: "20.0%" },
      "61-75": { total: 2, percentage: "13.3%" },
      "76-90": { total: 2, percentage: "13.3%" },
      "91-105": { total: 1, percentage: "6.7%" },
      "106-120": { total: null, percentage: null },
    },
    goalsForUnderOver: {
      "0.5": { over: 18, under: 2 },
      "1.5": { over: 14, under: 6 },
      "2.5": { over: 10, under: 10 },
      "3.5": { over: 5, under: 15 },
      "4.5": { over: 2, under: 18 },
    },
    goalsAgainstUnderOver: {
      "0.5": { over: 12, under: 8 },
      "1.5": { over: 6, under: 14 },
      "2.5": { over: 3, under: 17 },
      "3.5": { over: 1, under: 19 },
      "4.5": { over: 0, under: 20 },
    },
    ...overrides,
  };
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
    homeTeamSeasonStats: makeSeasonStats(),
    awayTeamSeasonStats: makeSeasonStats(),
    homeTeamPlayers: [
      makePlayerStats({ playerId: 1, name: "Home P1", rating: 7.2, goals: 8, assists: 5 }),
      makePlayerStats({ playerId: 2, name: "Home P2", rating: 6.8, goals: 3, assists: 2 }),
    ],
    awayTeamPlayers: [
      makePlayerStats({ playerId: 3, name: "Away P1", rating: 6.9, goals: 6, assists: 4 }),
      makePlayerStats({ playerId: 4, name: "Away P2", rating: 6.7, goals: 2, assists: 1 }),
    ],
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

describe("FEATURE_NAMES", () => {
  it("has exactly 21 entries", () => {
    expect(FEATURE_NAMES).toHaveLength(21);
  });

  it("contains all expected feature names", () => {
    const expected = [
      "homeWinRate",
      "awayLossRate",
      "formDiff",
      "h2h",
      "goalDiff",
      "pointsPerGame",
      "defensiveStrength",
      "injuryImpact",
      "cleanSheetDiff",
      "scoringConsistency",
      "winStreakMomentum",
      "penaltyReliability",
      "lateGoalThreat",
      "lateGoalVulnerability",
      "overTwoFiveGoals",
      "defensiveOverTwoFive",
      "squadRating",
      "attackingOutput",
      "injuredKeyPlayers",
      "leagueTierDiff",
      "h2hRecentForm",
    ];
    for (const name of expected) {
      expect(FEATURE_NAMES).toContain(name);
    }
  });
});

describe("getMissingSignals", () => {
  it("returns empty array when all signals present", () => {
    const signals: Record<string, number> = {};
    for (const name of FEATURE_NAMES) {
      signals[name] = 0;
    }
    expect(getMissingSignals(signals)).toEqual([]);
  });

  it("returns missing signal names when some are absent", () => {
    const signals: Record<string, number> = {
      homeWinRate: 0.4,
      formDiff: 0.3,
      h2h: 0.3,
      awayLossRate: 0,
      goalDiff: 0,
      pointsPerGame: 0,
      defensiveStrength: 0,
    };
    const missing = getMissingSignals(signals);
    expect(missing).toContain("injuryImpact");
    expect(missing).toContain("cleanSheetDiff");
    expect(missing).toContain("scoringConsistency");
    expect(missing.length).toBeGreaterThanOrEqual(3);
  });

  it("returns all signal names when signals object is empty", () => {
    const missing = getMissingSignals({});
    expect(missing).toHaveLength(21);
    expect(missing).toEqual(FEATURE_NAMES);
  });
});

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
      expect(getFeature("homeWinRate").extract(stats)).toBe(0.5);
    });

    it("returns 0.5 for zero played", () => {
      const stats = makeStatistics({
        homeTeam: {
          ...makeStatistics().homeTeam,
          homeRecord: { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 },
        },
      });
      expect(getFeature("homeWinRate").extract(stats)).toBe(0.5);
    });
  });

  describe("awayLossRate", () => {
    it("returns correct away loss rate", () => {
      const stats = makeStatistics();
      // awayRecord: played=10, losses=2 → 0.2
      expect(getFeature("awayLossRate").extract(stats)).toBe(0.2);
    });

    it("returns 0.5 for zero played", () => {
      const stats = makeStatistics({
        awayTeam: {
          ...makeStatistics().awayTeam,
          awayRecord: { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 },
        },
      });
      expect(getFeature("awayLossRate").extract(stats)).toBe(0.5);
    });
  });

  describe("formDiff", () => {
    it("returns 1.0 when home has all wins and away all losses", () => {
      const stats = makeStatistics({
        homeTeam: { ...makeStatistics().homeTeam, form: "WWWWW" },
        awayTeam: { ...makeStatistics().awayTeam, form: "LLLLL" },
      });
      expect(getFeature("formDiff").extract(stats)).toBe(1.0);
    });

    it("returns 0.0 when home has all losses and away all wins", () => {
      const stats = makeStatistics({
        homeTeam: { ...makeStatistics().homeTeam, form: "LLLLL" },
        awayTeam: { ...makeStatistics().awayTeam, form: "WWWWW" },
      });
      expect(getFeature("formDiff").extract(stats)).toBe(0.0);
    });

    it("returns 0.5 when forms are equal", () => {
      const stats = makeStatistics({
        homeTeam: { ...makeStatistics().homeTeam, form: "WWDLL" },
        awayTeam: { ...makeStatistics().awayTeam, form: "WWDLL" },
      });
      expect(getFeature("formDiff").extract(stats)).toBe(0.5);
    });

    it("handles null form gracefully", () => {
      const stats = makeStatistics({
        homeTeam: { ...makeStatistics().homeTeam, form: null },
        awayTeam: { ...makeStatistics().awayTeam, form: null },
      });
      expect(getFeature("formDiff").extract(stats)).toBe(0.5);
    });
  });

  describe("h2h", () => {
    it("returns correct ratio", () => {
      const stats = makeStatistics();
      // totalMatches: 5, homeWins: 3 → 0.6
      expect(getFeature("h2h").extract(stats)).toBe(0.6);
    });

    it("returns 0.5 for zero matches", () => {
      const stats = makeStatistics({
        h2h: { totalMatches: 0, homeWins: 0, awayWins: 0, draws: 0, recentMatches: [] },
      });
      expect(getFeature("h2h").extract(stats)).toBe(0.5);
    });
  });

  describe("goalDiff", () => {
    it("returns value in [0, 1]", () => {
      const stats = makeStatistics();
      const value = getFeature("goalDiff").extract(stats);
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
      expect(getFeature("goalDiff").extract(stats)).toBe(0.5);
    });
  });

  describe("pointsPerGame", () => {
    it("returns value in [0, 1]", () => {
      const stats = makeStatistics();
      const value = getFeature("pointsPerGame").extract(stats);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });

    it("returns > 0.5 when home has more points per game", () => {
      const stats = makeStatistics();
      // home: 41/20 = 2.05 ppg, away: 34/20 = 1.7 ppg → home better
      expect(getFeature("pointsPerGame").extract(stats)).toBeGreaterThan(0.5);
    });
  });

  describe("defensiveStrength", () => {
    it("returns value in [0, 1]", () => {
      const stats = makeStatistics();
      const value = getFeature("defensiveStrength").extract(stats);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });
  });

  describe("injuryImpact", () => {
    it("returns 0.5 when no injuries", () => {
      const stats = makeStatistics();
      expect(getFeature("injuryImpact").extract(stats)).toBe(0.5);
    });

    it("returns >0.5 when away team has more missing players", () => {
      const stats = makeStatistics({
        injuries: [
          { playerId: 10, playerName: "Away P1", type: "Missing Fixture", reason: "Knee", teamId: 2 },
          { playerId: 11, playerName: "Away P2", type: "Missing Fixture", reason: "Suspension", teamId: 2 },
        ],
      });
      expect(getFeature("injuryImpact").extract(stats)).toBeGreaterThan(0.5);
    });

    it("returns <0.5 when home team has more missing players", () => {
      const stats = makeStatistics({
        injuries: [
          { playerId: 10, playerName: "Home P1", type: "Missing Fixture", reason: "Knee", teamId: 1 },
          { playerId: 11, playerName: "Home P2", type: "Missing Fixture", reason: "Suspension", teamId: 1 },
          { playerId: 12, playerName: "Home P3", type: "Missing Fixture", reason: "Illness", teamId: 1 },
        ],
      });
      expect(getFeature("injuryImpact").extract(stats)).toBeLessThan(0.5);
    });

    it("ignores Questionable players, only counts Missing Fixture", () => {
      const stats = makeStatistics({
        injuries: [
          { playerId: 10, playerName: "Away P1", type: "Missing Fixture", reason: "Knee", teamId: 2 },
          { playerId: 11, playerName: "Away P2", type: "Questionable", reason: "Illness", teamId: 2 },
        ],
      });
      // Only 1 Missing Fixture for away, 0 for home → (1/6 + 0.5)
      const value = getFeature("injuryImpact").extract(stats);
      expect(value).toBeGreaterThan(0.5);
      // But less than if both counted (which would be 2/6 + 0.5)
      expect(value).toBeLessThan(0.5 + 2 / 6);
    });
  });

  describe("cleanSheetDiff", () => {
    it("returns 0.5 when no season stats", () => {
      const stats = makeStatistics({
        homeTeamSeasonStats: undefined,
        awayTeamSeasonStats: undefined,
      });
      expect(getFeature("cleanSheetDiff").extract(stats)).toBe(0.5);
    });

    it("returns >0.5 when home team keeps more clean sheets", () => {
      const stats = makeStatistics({
        homeTeamSeasonStats: makeSeasonStats({ cleanSheets: { home: 8, away: 4, total: 12 } }),
        awayTeamSeasonStats: makeSeasonStats({ cleanSheets: { home: 2, away: 1, total: 3 } }),
      });
      expect(getFeature("cleanSheetDiff").extract(stats)).toBeGreaterThan(0.5);
    });
  });

  describe("scoringConsistency", () => {
    it("returns 0.5 when no season stats", () => {
      const stats = makeStatistics({
        homeTeamSeasonStats: undefined,
        awayTeamSeasonStats: undefined,
      });
      expect(getFeature("scoringConsistency").extract(stats)).toBe(0.5);
    });

    it("returns >0.5 when away team fails to score more often", () => {
      const stats = makeStatistics({
        homeTeamSeasonStats: makeSeasonStats({ failedToScore: { home: 1, away: 1, total: 2 } }),
        awayTeamSeasonStats: makeSeasonStats({ failedToScore: { home: 5, away: 5, total: 10 } }),
      });
      expect(getFeature("scoringConsistency").extract(stats)).toBeGreaterThan(0.5);
    });
  });

  // ── New extractors ─────────────────────────────────────────────────

  describe("winStreakMomentum", () => {
    it("returns 0.5 when no season stats", () => {
      const stats = makeStatistics({
        homeTeamSeasonStats: undefined,
        awayTeamSeasonStats: undefined,
      });
      expect(getFeature("winStreakMomentum").extract(stats)).toBe(0.5);
    });

    it("returns >0.5 when home has longer win streak", () => {
      const stats = makeStatistics({
        homeTeamSeasonStats: makeSeasonStats({ biggestStreak: { wins: 8, draws: 1, loses: 1 } }),
        awayTeamSeasonStats: makeSeasonStats({ biggestStreak: { wins: 2, draws: 1, loses: 3 } }),
      });
      expect(getFeature("winStreakMomentum").extract(stats)).toBeGreaterThan(0.5);
    });

    it("returns <0.5 when away has longer win streak", () => {
      const stats = makeStatistics({
        homeTeamSeasonStats: makeSeasonStats({ biggestStreak: { wins: 1, draws: 1, loses: 3 } }),
        awayTeamSeasonStats: makeSeasonStats({ biggestStreak: { wins: 7, draws: 1, loses: 1 } }),
      });
      expect(getFeature("winStreakMomentum").extract(stats)).toBeLessThan(0.5);
    });

    it("is clamped to [0, 1]", () => {
      const stats = makeStatistics({
        homeTeamSeasonStats: makeSeasonStats({ biggestStreak: { wins: 20, draws: 0, loses: 0 } }),
        awayTeamSeasonStats: makeSeasonStats({ biggestStreak: { wins: 0, draws: 0, loses: 10 } }),
      });
      const value = getFeature("winStreakMomentum").extract(stats);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });
  });

  describe("penaltyReliability", () => {
    it("returns 0.5 when no season stats", () => {
      const stats = makeStatistics({
        homeTeamSeasonStats: undefined,
        awayTeamSeasonStats: undefined,
      });
      expect(getFeature("penaltyReliability").extract(stats)).toBe(0.5);
    });

    it("returns >0.5 when home converts more penalties", () => {
      const stats = makeStatistics({
        homeTeamSeasonStats: makeSeasonStats({ penaltyRecord: { scored: 5, missed: 0, total: 5 } }),
        awayTeamSeasonStats: makeSeasonStats({ penaltyRecord: { scored: 1, missed: 4, total: 5 } }),
      });
      expect(getFeature("penaltyReliability").extract(stats)).toBeGreaterThan(0.5);
    });

    it("returns 0.5 when both have zero penalties", () => {
      const stats = makeStatistics({
        homeTeamSeasonStats: makeSeasonStats({ penaltyRecord: { scored: 0, missed: 0, total: 0 } }),
        awayTeamSeasonStats: makeSeasonStats({ penaltyRecord: { scored: 0, missed: 0, total: 0 } }),
      });
      expect(getFeature("penaltyReliability").extract(stats)).toBe(0.5);
    });
  });

  describe("lateGoalThreat", () => {
    it("returns 0.5 when no season stats", () => {
      const stats = makeStatistics({
        homeTeamSeasonStats: undefined,
        awayTeamSeasonStats: undefined,
      });
      expect(getFeature("lateGoalThreat").extract(stats)).toBe(0.5);
    });

    it("returns >0.5 when home scores more late goals proportionally", () => {
      const homeGoals = {
        "0-15": { total: 2, percentage: "10%" },
        "16-30": { total: 2, percentage: "10%" },
        "31-45": { total: 2, percentage: "10%" },
        "46-60": { total: 2, percentage: "10%" },
        "61-75": { total: 2, percentage: "10%" },
        "76-90": { total: 5, percentage: "25%" },
        "91-105": { total: 5, percentage: "25%" },
        "106-120": { total: null, percentage: null },
      };
      const awayGoals = {
        "0-15": { total: 5, percentage: "25%" },
        "16-30": { total: 5, percentage: "25%" },
        "31-45": { total: 5, percentage: "25%" },
        "46-60": { total: 3, percentage: "15%" },
        "61-75": { total: 2, percentage: "10%" },
        "76-90": { total: 0, percentage: "0%" },
        "91-105": { total: 0, percentage: "0%" },
        "106-120": { total: null, percentage: null },
      };
      const stats = makeStatistics({
        homeTeamSeasonStats: makeSeasonStats({ goalsForByMinute: homeGoals }),
        awayTeamSeasonStats: makeSeasonStats({ goalsForByMinute: awayGoals }),
      });
      expect(getFeature("lateGoalThreat").extract(stats)).toBeGreaterThan(0.5);
    });

    it("returns 0.5 when all goals-by-minute totals are null", () => {
      const nullGoals = {
        "0-15": { total: null, percentage: null },
        "16-30": { total: null, percentage: null },
        "31-45": { total: null, percentage: null },
        "46-60": { total: null, percentage: null },
        "61-75": { total: null, percentage: null },
        "76-90": { total: null, percentage: null },
        "91-105": { total: null, percentage: null },
        "106-120": { total: null, percentage: null },
      };
      const stats = makeStatistics({
        homeTeamSeasonStats: makeSeasonStats({ goalsForByMinute: nullGoals }),
        awayTeamSeasonStats: makeSeasonStats({ goalsForByMinute: nullGoals }),
      });
      // Both proportions are 0 when total is 0 → diff is 0 → 0.5
      expect(getFeature("lateGoalThreat").extract(stats)).toBe(0.5);
    });
  });

  describe("lateGoalVulnerability", () => {
    it("returns 0.5 when no season stats", () => {
      const stats = makeStatistics({
        homeTeamSeasonStats: undefined,
        awayTeamSeasonStats: undefined,
      });
      expect(getFeature("lateGoalVulnerability").extract(stats)).toBe(0.5);
    });

    it("returns >0.5 when away concedes more late goals", () => {
      const awayAgainst = {
        "0-15": { total: 1, percentage: "5%" },
        "16-30": { total: 1, percentage: "5%" },
        "31-45": { total: 1, percentage: "5%" },
        "46-60": { total: 1, percentage: "5%" },
        "61-75": { total: 1, percentage: "5%" },
        "76-90": { total: 8, percentage: "40%" },
        "91-105": { total: 7, percentage: "35%" },
        "106-120": { total: null, percentage: null },
      };
      const homeAgainst = {
        "0-15": { total: 3, percentage: "20%" },
        "16-30": { total: 3, percentage: "20%" },
        "31-45": { total: 3, percentage: "20%" },
        "46-60": { total: 3, percentage: "20%" },
        "61-75": { total: 2, percentage: "13%" },
        "76-90": { total: 1, percentage: "7%" },
        "91-105": { total: 0, percentage: "0%" },
        "106-120": { total: null, percentage: null },
      };
      const stats = makeStatistics({
        homeTeamSeasonStats: makeSeasonStats({ goalsAgainstByMinute: homeAgainst }),
        awayTeamSeasonStats: makeSeasonStats({ goalsAgainstByMinute: awayAgainst }),
      });
      expect(getFeature("lateGoalVulnerability").extract(stats)).toBeGreaterThan(0.5);
    });
  });

  describe("overTwoFiveGoals", () => {
    it("returns 0.5 when no season stats", () => {
      const stats = makeStatistics({
        homeTeamSeasonStats: undefined,
        awayTeamSeasonStats: undefined,
      });
      expect(getFeature("overTwoFiveGoals").extract(stats)).toBe(0.5);
    });

    it("returns >0.5 when home has higher over-2.5 rate", () => {
      const stats = makeStatistics({
        homeTeamSeasonStats: makeSeasonStats({
          goalsForUnderOver: {
            "0.5": { over: 20, under: 0 },
            "1.5": { over: 18, under: 2 },
            "2.5": { over: 16, under: 4 },
            "3.5": { over: 10, under: 10 },
            "4.5": { over: 5, under: 15 },
          },
        }),
        awayTeamSeasonStats: makeSeasonStats({
          goalsForUnderOver: {
            "0.5": { over: 15, under: 5 },
            "1.5": { over: 10, under: 10 },
            "2.5": { over: 4, under: 16 },
            "3.5": { over: 2, under: 18 },
            "4.5": { over: 0, under: 20 },
          },
        }),
      });
      expect(getFeature("overTwoFiveGoals").extract(stats)).toBeGreaterThan(0.5);
    });

    it("returns 0.5 when both have zero total games", () => {
      const zeroUO = {
        "0.5": { over: 0, under: 0 },
        "1.5": { over: 0, under: 0 },
        "2.5": { over: 0, under: 0 },
        "3.5": { over: 0, under: 0 },
        "4.5": { over: 0, under: 0 },
      };
      const stats = makeStatistics({
        homeTeamSeasonStats: makeSeasonStats({ goalsForUnderOver: zeroUO }),
        awayTeamSeasonStats: makeSeasonStats({ goalsForUnderOver: zeroUO }),
      });
      expect(getFeature("overTwoFiveGoals").extract(stats)).toBe(0.5);
    });
  });

  describe("defensiveOverTwoFive", () => {
    it("returns 0.5 when no season stats", () => {
      const stats = makeStatistics({
        homeTeamSeasonStats: undefined,
        awayTeamSeasonStats: undefined,
      });
      expect(getFeature("defensiveOverTwoFive").extract(stats)).toBe(0.5);
    });

    it("returns >0.5 when away concedes over 2.5 more often", () => {
      const stats = makeStatistics({
        homeTeamSeasonStats: makeSeasonStats({
          goalsAgainstUnderOver: {
            "0.5": { over: 10, under: 10 },
            "1.5": { over: 5, under: 15 },
            "2.5": { over: 2, under: 18 },
            "3.5": { over: 0, under: 20 },
            "4.5": { over: 0, under: 20 },
          },
        }),
        awayTeamSeasonStats: makeSeasonStats({
          goalsAgainstUnderOver: {
            "0.5": { over: 18, under: 2 },
            "1.5": { over: 14, under: 6 },
            "2.5": { over: 12, under: 8 },
            "3.5": { over: 8, under: 12 },
            "4.5": { over: 4, under: 16 },
          },
        }),
      });
      expect(getFeature("defensiveOverTwoFive").extract(stats)).toBeGreaterThan(0.5);
    });
  });

  describe("squadRating", () => {
    it("returns 0.5 when no player data", () => {
      const stats = makeStatistics({
        homeTeamPlayers: undefined,
        awayTeamPlayers: undefined,
      });
      expect(getFeature("squadRating").extract(stats)).toBe(0.5);
    });

    it("returns 0.5 when player arrays are empty", () => {
      const stats = makeStatistics({
        homeTeamPlayers: [],
        awayTeamPlayers: [],
      });
      expect(getFeature("squadRating").extract(stats)).toBe(0.5);
    });

    it("returns >0.5 when home squad has higher average rating", () => {
      const stats = makeStatistics({
        homeTeamPlayers: [
          makePlayerStats({ rating: 7.5 }),
          makePlayerStats({ rating: 7.3 }),
        ],
        awayTeamPlayers: [
          makePlayerStats({ rating: 6.5 }),
          makePlayerStats({ rating: 6.3 }),
        ],
      });
      expect(getFeature("squadRating").extract(stats)).toBeGreaterThan(0.5);
    });

    it("treats null ratings as 6.5", () => {
      const stats = makeStatistics({
        homeTeamPlayers: [makePlayerStats({ rating: null })],
        awayTeamPlayers: [makePlayerStats({ rating: null })],
      });
      // Both average 6.5 → diff is 0 → 0.5
      expect(getFeature("squadRating").extract(stats)).toBe(0.5);
    });
  });

  describe("attackingOutput", () => {
    it("returns 0.5 when no player data", () => {
      const stats = makeStatistics({
        homeTeamPlayers: undefined,
        awayTeamPlayers: undefined,
      });
      expect(getFeature("attackingOutput").extract(stats)).toBe(0.5);
    });

    it("returns >0.5 when home has higher per-player output", () => {
      const stats = makeStatistics({
        homeTeamPlayers: [
          makePlayerStats({ goals: 10, assists: 8 }),
          makePlayerStats({ goals: 8, assists: 5 }),
        ],
        awayTeamPlayers: [
          makePlayerStats({ goals: 2, assists: 1 }),
          makePlayerStats({ goals: 1, assists: 0 }),
        ],
      });
      expect(getFeature("attackingOutput").extract(stats)).toBeGreaterThan(0.5);
    });

    it("is clamped to [0, 1]", () => {
      const stats = makeStatistics({
        homeTeamPlayers: [makePlayerStats({ goals: 30, assists: 20 })],
        awayTeamPlayers: [makePlayerStats({ goals: 0, assists: 0 })],
      });
      const value = getFeature("attackingOutput").extract(stats);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });
  });

  describe("injuredKeyPlayers", () => {
    it("returns 0.5 when no player data", () => {
      const stats = makeStatistics({
        homeTeamPlayers: undefined,
        awayTeamPlayers: undefined,
      });
      expect(getFeature("injuredKeyPlayers").extract(stats)).toBe(0.5);
    });

    it("returns >0.5 when away has more quality injured", () => {
      const stats = makeStatistics({
        homeTeamPlayers: [
          makePlayerStats({ injured: false, rating: 7.5 }),
        ],
        awayTeamPlayers: [
          makePlayerStats({ injured: true, rating: 7.8 }),
          makePlayerStats({ injured: true, rating: 7.2 }),
        ],
      });
      expect(getFeature("injuredKeyPlayers").extract(stats)).toBeGreaterThan(0.5);
    });

    it("returns <0.5 when home has more quality injured", () => {
      const stats = makeStatistics({
        homeTeamPlayers: [
          makePlayerStats({ injured: true, rating: 7.8 }),
          makePlayerStats({ injured: true, rating: 7.5 }),
        ],
        awayTeamPlayers: [
          makePlayerStats({ injured: false, rating: 7.0 }),
        ],
      });
      expect(getFeature("injuredKeyPlayers").extract(stats)).toBeLessThan(0.5);
    });

    it("returns 0.5 when no players are injured", () => {
      const stats = makeStatistics({
        homeTeamPlayers: [makePlayerStats({ injured: false })],
        awayTeamPlayers: [makePlayerStats({ injured: false })],
      });
      expect(getFeature("injuredKeyPlayers").extract(stats)).toBe(0.5);
    });
  });

  describe("leagueTierDiff", () => {
    it("returns 0.5 when no league tier data", () => {
      const stats = makeStatistics();
      // makeStatistics doesn't set league tiers by default
      expect(getFeature("leagueTierDiff").extract(stats)).toBe(0.5);
    });

    it("returns 0.5 when both teams are in the same tier", () => {
      const stats = makeStatistics({
        homeTeamLeagueTier: 1,
        awayTeamLeagueTier: 1,
      });
      expect(getFeature("leagueTierDiff").extract(stats)).toBe(0.5);
    });

    it("returns >0.5 when home team is in a stronger league", () => {
      const stats = makeStatistics({
        homeTeamLeagueTier: 1,
        awayTeamLeagueTier: 3,
      });
      expect(getFeature("leagueTierDiff").extract(stats)).toBeGreaterThan(0.5);
    });

    it("returns <0.5 when away team is in a stronger league", () => {
      const stats = makeStatistics({
        homeTeamLeagueTier: 3,
        awayTeamLeagueTier: 1,
      });
      expect(getFeature("leagueTierDiff").extract(stats)).toBeLessThan(0.5);
    });

    it("is clamped to [0, 1]", () => {
      const stats = makeStatistics({
        homeTeamLeagueTier: 1,
        awayTeamLeagueTier: 5,
      });
      const value = getFeature("leagueTierDiff").extract(stats);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });

    it("returns 1.0 when tier diff is at max (4 tiers apart, home stronger)", () => {
      const stats = makeStatistics({
        homeTeamLeagueTier: 1,
        awayTeamLeagueTier: 5,
      });
      expect(getFeature("leagueTierDiff").extract(stats)).toBe(1.0);
    });

    it("returns 0.0 when tier diff is at max (4 tiers apart, away stronger)", () => {
      const stats = makeStatistics({
        homeTeamLeagueTier: 5,
        awayTeamLeagueTier: 1,
      });
      expect(getFeature("leagueTierDiff").extract(stats)).toBe(0.0);
    });
  });

  describe("h2hRecentForm", () => {
    it("returns 0.5 when no recent matches", () => {
      const stats = makeStatistics({
        h2h: { totalMatches: 5, homeWins: 3, awayWins: 1, draws: 1, recentMatches: [] },
      });
      expect(getFeature("h2hRecentForm").extract(stats)).toBe(0.5);
    });

    it("returns 1.0 when home team won all recent H2H", () => {
      const stats = makeStatistics({
        h2h: {
          totalMatches: 5,
          homeWins: 3,
          awayWins: 1,
          draws: 1,
          recentMatches: [
            { date: "2024-10-20", homeTeam: "Arsenal", awayTeam: "Chelsea", homeGoals: 2, awayGoals: 0 },
            { date: "2024-04-23", homeTeam: "Chelsea", awayTeam: "Arsenal", homeGoals: 0, awayGoals: 3 },
            { date: "2023-10-21", homeTeam: "Arsenal", awayTeam: "Chelsea", homeGoals: 1, awayGoals: 0 },
          ],
        },
      });
      expect(getFeature("h2hRecentForm").extract(stats)).toBe(1.0);
    });

    it("returns 0.0 when home team lost all recent H2H", () => {
      const stats = makeStatistics({
        h2h: {
          totalMatches: 5,
          homeWins: 0,
          awayWins: 5,
          draws: 0,
          recentMatches: [
            { date: "2024-10-20", homeTeam: "Arsenal", awayTeam: "Chelsea", homeGoals: 0, awayGoals: 2 },
            { date: "2024-04-23", homeTeam: "Chelsea", awayTeam: "Arsenal", homeGoals: 3, awayGoals: 0 },
          ],
        },
      });
      expect(getFeature("h2hRecentForm").extract(stats)).toBe(0.0);
    });

    it("handles draws correctly", () => {
      const stats = makeStatistics({
        h2h: {
          totalMatches: 2,
          homeWins: 0,
          awayWins: 0,
          draws: 2,
          recentMatches: [
            { date: "2024-10-20", homeTeam: "Arsenal", awayTeam: "Chelsea", homeGoals: 1, awayGoals: 1 },
            { date: "2024-04-23", homeTeam: "Chelsea", awayTeam: "Arsenal", homeGoals: 2, awayGoals: 2 },
          ],
        },
      });
      expect(getFeature("h2hRecentForm").extract(stats)).toBe(0.5);
    });

    it("only considers last 5 matches", () => {
      const stats = makeStatistics({
        h2h: {
          totalMatches: 7,
          homeWins: 5,
          awayWins: 2,
          draws: 0,
          recentMatches: [
            { date: "2024-10", homeTeam: "Arsenal", awayTeam: "Chelsea", homeGoals: 2, awayGoals: 0 },
            { date: "2024-04", homeTeam: "Arsenal", awayTeam: "Chelsea", homeGoals: 2, awayGoals: 0 },
            { date: "2023-10", homeTeam: "Arsenal", awayTeam: "Chelsea", homeGoals: 2, awayGoals: 0 },
            { date: "2023-04", homeTeam: "Arsenal", awayTeam: "Chelsea", homeGoals: 2, awayGoals: 0 },
            { date: "2022-10", homeTeam: "Arsenal", awayTeam: "Chelsea", homeGoals: 2, awayGoals: 0 },
            // These should NOT be counted:
            { date: "2022-04", homeTeam: "Arsenal", awayTeam: "Chelsea", homeGoals: 0, awayGoals: 5 },
            { date: "2021-10", homeTeam: "Arsenal", awayTeam: "Chelsea", homeGoals: 0, awayGoals: 5 },
          ],
        },
      });
      // Only first 5 count → all wins → 1.0
      expect(getFeature("h2hRecentForm").extract(stats)).toBe(1.0);
    });
  });
});

describe("extractFeatures", () => {
  it("returns all 21 features", () => {
    const features = extractFeatures(makeStatistics());
    expect(Object.keys(features)).toHaveLength(21);
    for (const name of FEATURE_NAMES) {
      expect(features[name]).toBeDefined();
    }
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

describe("FeatureEntry metadata", () => {
  it("every entry has a non-empty description", () => {
    for (const [name, entry] of Object.entries(FEATURE_REGISTRY)) {
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("every entry has at least one source", () => {
    for (const [name, entry] of Object.entries(FEATURE_REGISTRY)) {
      expect(entry.sources.length).toBeGreaterThan(0);
    }
  });
});

describe("feature coverage", () => {
  /**
   * Curated list of Statistics paths that carry predictive signal.
   * When a new field is added to Statistics, either:
   *   1. Add it here + create an extractor, OR
   *   2. Explicitly exclude it in the comment below.
   *
   * Deliberately excluded:
   * - Metadata: fixtureId, league.*, *.teamId, *.teamName
   * - Engine-consumed: markets.*
   * - Redundant: homeTeamSeasonStats.form / awayTeamSeasonStats.form (covered by formDiff via homeTeam.form)
   * - Denominators: homeTeamSeasonStats.fixtures.played.* (used internally by other extractors)
   * - Categorical: preferredFormations (string formation names don't produce meaningful 0-1 comparison)
   * - Granular player fields: shotsTotal, shotsOnTarget, passesKey, passAccuracy,
   *   dribblesSuccess, dribblesAttempts, yellowCards, redCards, appearances, minutes,
   *   playerId, name, position (too noisy for initial pass)
   */
  const FEATURE_RELEVANT_PATHS = [
    // TeamStats
    "homeTeam.homeRecord",
    "awayTeam.awayRecord",
    "homeTeam.form",
    "awayTeam.form",
    "homeTeam.goalDifference",
    "homeTeam.played",
    "awayTeam.goalDifference",
    "awayTeam.played",
    "homeTeam.points",
    "awayTeam.points",
    "homeTeam.goalsAgainst",
    "awayTeam.goalsAgainst",
    // Injuries
    "injuries",
    // H2H
    "h2h.totalMatches",
    "h2h.homeWins",
    "h2h.awayWins",
    "h2h.draws",
    "h2h.recentMatches",
    // TeamSeasonStats
    "homeTeamSeasonStats.cleanSheets",
    "awayTeamSeasonStats.cleanSheets",
    "homeTeamSeasonStats.failedToScore",
    "awayTeamSeasonStats.failedToScore",
    "homeTeamSeasonStats.biggestStreak",
    "awayTeamSeasonStats.biggestStreak",
    "homeTeamSeasonStats.penaltyRecord",
    "awayTeamSeasonStats.penaltyRecord",
    "homeTeamSeasonStats.goalsForByMinute",
    "awayTeamSeasonStats.goalsForByMinute",
    "homeTeamSeasonStats.goalsAgainstByMinute",
    "awayTeamSeasonStats.goalsAgainstByMinute",
    "homeTeamSeasonStats.goalsForUnderOver",
    "awayTeamSeasonStats.goalsForUnderOver",
    "homeTeamSeasonStats.goalsAgainstUnderOver",
    "awayTeamSeasonStats.goalsAgainstUnderOver",
    // PlayerSeasonStats
    "homeTeamPlayers.*.rating",
    "awayTeamPlayers.*.rating",
    "homeTeamPlayers.*.goals",
    "homeTeamPlayers.*.assists",
    "awayTeamPlayers.*.goals",
    "awayTeamPlayers.*.assists",
    "homeTeamPlayers.*.injured",
    "homeTeamPlayers.*.rating",
    "awayTeamPlayers.*.injured",
    "awayTeamPlayers.*.rating",
    // League tier
    "homeTeamLeagueTier",
    "awayTeamLeagueTier",
  ];

  // Deduplicate for the check
  const uniquePaths = [...new Set(FEATURE_RELEVANT_PATHS)];

  it("every relevant path is claimed by at least one extractor", () => {
    const allSources = Object.values(FEATURE_REGISTRY).flatMap((e) => e.sources);
    for (const path of uniquePaths) {
      expect(allSources).toContain(path);
    }
  });

  it("every extractor source exists in the relevant paths list (no typos or stale sources)", () => {
    for (const [name, entry] of Object.entries(FEATURE_REGISTRY)) {
      for (const source of entry.sources) {
        expect(uniquePaths).toContain(source);
      }
    }
  });
});
