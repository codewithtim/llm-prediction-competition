import { describe, expect, it } from "bun:test";
import { statisticsSchema } from "../../../../src/domain/contracts/statistics";

function makeTeamStats(overrides?: Record<string, unknown>) {
  return {
    teamId: 1,
    teamName: "Arsenal",
    played: 20,
    wins: 14,
    draws: 3,
    losses: 3,
    goalsFor: 42,
    goalsAgainst: 15,
    goalDifference: 27,
    points: 45,
    form: "WWDWW",
    homeRecord: { played: 10, wins: 8, draws: 1, losses: 1, goalsFor: 24, goalsAgainst: 6 },
    awayRecord: { played: 10, wins: 6, draws: 2, losses: 2, goalsFor: 18, goalsAgainst: 9 },
    ...overrides,
  };
}

function makeValidStatistics(overrides?: Record<string, unknown>) {
  return {
    fixtureId: 123,
    league: { id: 39, name: "Premier League", country: "England", season: 2025 },
    homeTeam: makeTeamStats(),
    awayTeam: makeTeamStats({ teamId: 2, teamName: "Chelsea" }),
    h2h: {
      totalMatches: 5,
      homeWins: 3,
      awayWins: 1,
      draws: 1,
      recentMatches: [
        {
          date: "2025-01-15",
          homeTeam: "Arsenal",
          awayTeam: "Chelsea",
          homeGoals: 2,
          awayGoals: 1,
        },
      ],
    },
    market: {
      marketId: "abc-123",
      question: "Will Arsenal win?",
      currentYesPrice: 0.65,
      currentNoPrice: 0.35,
      liquidity: 50000,
      volume: 120000,
      sportsMarketType: "moneyline",
      line: null,
    },
    ...overrides,
  };
}

describe("statisticsSchema", () => {
  it("accepts valid statistics", () => {
    expect(() => statisticsSchema.parse(makeValidStatistics())).not.toThrow();
  });

  it("accepts null form", () => {
    const stats = makeValidStatistics({
      homeTeam: makeTeamStats({ form: null }),
    });
    expect(() => statisticsSchema.parse(stats)).not.toThrow();
  });

  it("accepts null sportsMarketType and line", () => {
    const stats = makeValidStatistics({
      market: {
        marketId: "abc-123",
        question: "Will Arsenal win?",
        currentYesPrice: 0.65,
        currentNoPrice: 0.35,
        liquidity: 50000,
        volume: 120000,
        sportsMarketType: null,
        line: null,
      },
    });
    expect(() => statisticsSchema.parse(stats)).not.toThrow();
  });

  it("accepts empty recentMatches array", () => {
    const stats = makeValidStatistics();
    stats.h2h.recentMatches = [];
    expect(() => statisticsSchema.parse(stats)).not.toThrow();
  });

  it("rejects missing fixtureId", () => {
    const { fixtureId: _, ...rest } = makeValidStatistics();
    expect(() => statisticsSchema.parse(rest)).toThrow();
  });

  it("rejects missing league", () => {
    const { league: _, ...rest } = makeValidStatistics();
    expect(() => statisticsSchema.parse(rest)).toThrow();
  });

  it("rejects missing homeTeam", () => {
    const { homeTeam: _, ...rest } = makeValidStatistics();
    expect(() => statisticsSchema.parse(rest)).toThrow();
  });

  it("rejects string fixtureId", () => {
    expect(() => statisticsSchema.parse(makeValidStatistics({ fixtureId: "abc" }))).toThrow();
  });
});
