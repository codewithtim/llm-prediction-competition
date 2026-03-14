import { describe, expect, it } from "bun:test";
import {
  estimateLambdas,
  formModifier,
  h2hModifier,
  injuryModifier,
} from "../../../../src/competitors/monte-carlo-poisson/lambda";
import type { Statistics } from "../../../../src/domain/contracts/statistics";

const record = { played: 10, wins: 5, draws: 3, losses: 2, goalsFor: 15, goalsAgainst: 12 };

function makeStats(overrides?: Partial<Statistics>): Statistics {
  return {
    fixtureId: 1,
    league: { id: 39, name: "Premier League", country: "England", season: 2025 },
    homeTeam: {
      teamId: 1,
      teamName: "Home FC",
      played: 20,
      wins: 10,
      draws: 5,
      losses: 5,
      goalsFor: 30,
      goalsAgainst: 20,
      goalDifference: 10,
      points: 35,
      form: "WDWLW",
      homeRecord: record,
      awayRecord: record,
    },
    awayTeam: {
      teamId: 2,
      teamName: "Away FC",
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
    },
    h2h: { totalMatches: 2, homeWins: 1, awayWins: 0, draws: 1, recentMatches: [] },
    markets: [
      {
        marketId: "m1",
        question: "Will Home FC win?",
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

describe("formModifier", () => {
  it("returns > 1.0 for all wins", () => {
    expect(formModifier("WWWWW")).toBeGreaterThan(1.0);
  });

  it("returns < 1.0 for all losses", () => {
    expect(formModifier("LLLLL")).toBeLessThan(1.0);
  });

  it("returns moderate value for mixed form", () => {
    const mod = formModifier("WDLWW");
    expect(mod).toBeGreaterThan(0.9);
    expect(mod).toBeLessThan(1.15);
  });

  it("returns 1.0 for null", () => {
    expect(formModifier(null)).toBe(1.0);
  });
});

describe("h2hModifier", () => {
  it("returns 1.0 with fewer than 3 matches", () => {
    const h2h = { totalMatches: 2, homeWins: 2, awayWins: 0, draws: 0, recentMatches: [] };
    expect(h2hModifier(h2h, "Home FC")).toBe(1.0);
  });

  it("returns > 1.0 for dominant home H2H with recent matches", () => {
    const h2h = {
      totalMatches: 4,
      homeWins: 3,
      awayWins: 0,
      draws: 1,
      recentMatches: [
        { date: "2025-01-01", homeTeam: "Home FC", awayTeam: "Away FC", homeGoals: 3, awayGoals: 0 },
        { date: "2025-02-01", homeTeam: "Home FC", awayTeam: "Away FC", homeGoals: 2, awayGoals: 1 },
        { date: "2025-03-01", homeTeam: "Away FC", awayTeam: "Home FC", homeGoals: 0, awayGoals: 2 },
      ],
    };
    expect(h2hModifier(h2h, "Home FC")).toBeGreaterThan(1.0);
  });

  it("uses win rate when no recent matches", () => {
    const h2h = { totalMatches: 5, homeWins: 4, awayWins: 1, draws: 0, recentMatches: [] };
    const mod = h2hModifier(h2h, "Home FC");
    expect(mod).toBeGreaterThan(1.0);
  });
});

describe("injuryModifier", () => {
  it("returns 1.0 with no injuries", () => {
    expect(injuryModifier([], [], 1)).toBe(1.0);
  });

  it("returns 1.0 with undefined inputs", () => {
    expect(injuryModifier(undefined, undefined, 1)).toBe(1.0);
  });

  it("reduces modifier for key player injury", () => {
    const players = [
      {
        playerId: 10,
        name: "Star Striker",
        position: "Attacker",
        rating: 7.5,
        appearances: 15,
        minutes: 1200,
        goals: 8,
        assists: 3,
        shotsTotal: 40,
        shotsOnTarget: 20,
        passesKey: 5,
        passAccuracy: 80,
        dribblesSuccess: 10,
        dribblesAttempts: 15,
        yellowCards: 2,
        redCards: 0,
        injured: true,
      },
    ];
    const injuries = [{ playerId: 10, playerName: "Star Striker", type: "Missing Fixture", reason: "Knee Injury", teamId: 1 }];
    expect(injuryModifier(players, injuries, 1)).toBeLessThan(1.0);
  });

  it("is capped at 0.85", () => {
    const players = Array.from({ length: 5 }, (_, i) => ({
      playerId: i + 1,
      name: `Player ${i}`,
      position: "Attacker" as const,
      rating: 7.5,
      appearances: 15,
      minutes: 1200,
      goals: 5,
      assists: 3,
      shotsTotal: 30,
      shotsOnTarget: 15,
      passesKey: 5,
      passAccuracy: 80,
      dribblesSuccess: 8,
      dribblesAttempts: 12,
      yellowCards: 1,
      redCards: 0,
      injured: true,
    }));
    const injuries = players.map((p) => ({
      playerId: p.playerId,
      playerName: p.name,
      type: "Missing Fixture",
      reason: "Injury",
      teamId: 1,
    }));
    const mod = injuryModifier(players, injuries, 1);
    expect(mod).toBeGreaterThanOrEqual(0.85);
  });
});

describe("estimateLambdas", () => {
  it("produces lambdas close to league average for balanced teams", () => {
    const lambdas = estimateLambdas(makeStats());
    expect(lambdas.home).toBeGreaterThan(0.5);
    expect(lambdas.home).toBeLessThan(3.0);
    expect(lambdas.away).toBeGreaterThan(0.5);
    expect(lambdas.away).toBeLessThan(3.0);
  });

  it("produces higher home lambda for strong home team", () => {
    const stats = makeStats({
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
        awayRecord: record,
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
        homeRecord: record,
        awayRecord: { played: 10, wins: 1, draws: 1, losses: 8, goalsFor: 5, goalsAgainst: 25 },
      },
    });
    const lambdas = estimateLambdas(stats);
    expect(lambdas.home).toBeGreaterThan(lambdas.away);
  });

  it("clamps lambdas to [0.3, 4.0]", () => {
    const stats = makeStats({
      homeTeam: {
        teamId: 1,
        teamName: "Extreme FC",
        played: 20,
        wins: 20,
        draws: 0,
        losses: 0,
        goalsFor: 100,
        goalsAgainst: 0,
        goalDifference: 100,
        points: 60,
        form: "WWWWW",
        homeRecord: { played: 10, wins: 10, draws: 0, losses: 0, goalsFor: 60, goalsAgainst: 0 },
        awayRecord: record,
      },
    });
    const lambdas = estimateLambdas(stats);
    expect(lambdas.home).toBeLessThanOrEqual(4.0);
    expect(lambdas.home).toBeGreaterThanOrEqual(0.3);
    expect(lambdas.away).toBeLessThanOrEqual(4.0);
    expect(lambdas.away).toBeGreaterThanOrEqual(0.3);
  });
});
