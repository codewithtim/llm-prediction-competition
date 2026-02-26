import { describe, expect, test } from "bun:test";
import {
  mapApiFixtureToFixture,
  mapFixtureStatus,
  mapH2hFixturesToH2H,
  mapStandingToTeamStats,
} from "../../../../src/infrastructure/sports-data/mappers.ts";
import type {
  ApiFixture,
  ApiStandingEntry,
} from "../../../../src/infrastructure/sports-data/types.ts";

function makeApiFixture(
  overrides: {
    fixtureId?: number;
    date?: string;
    venueName?: string | null;
    statusShort?: string;
    leagueId?: number;
    season?: number;
    homeId?: number;
    homeName?: string;
    awayId?: number;
    awayName?: string;
    homeGoals?: number | null;
    awayGoals?: number | null;
  } = {},
): ApiFixture {
  return {
    fixture: {
      id: overrides.fixtureId ?? 1208261,
      referee: "S. Hooper",
      timezone: "UTC",
      date: overrides.date ?? "2025-02-01T12:30:00+00:00",
      timestamp: 1738413000,
      venue: {
        id: 566,
        name: "venueName" in overrides ? (overrides.venueName as string | null) : "The City Ground",
        city: "Nottingham",
      },
      status: {
        long: "Match Finished",
        short: overrides.statusShort ?? "FT",
        elapsed: 90,
        extra: null,
      },
    },
    league: {
      id: overrides.leagueId ?? 39,
      name: "Premier League",
      country: "England",
      logo: "https://example.com/logo.png",
      flag: "https://example.com/flag.svg",
      season: overrides.season ?? 2024,
      round: "Regular Season - 24",
    },
    teams: {
      home: {
        id: overrides.homeId ?? 65,
        name: overrides.homeName ?? "Nottingham Forest",
        logo: "https://example.com/nf.png",
        winner: true,
      },
      away: {
        id: overrides.awayId ?? 51,
        name: overrides.awayName ?? "Brighton",
        logo: "https://example.com/bri.png",
        winner: false,
      },
    },
    goals: {
      home: "homeGoals" in overrides ? (overrides.homeGoals as number | null) : 3,
      away: "awayGoals" in overrides ? (overrides.awayGoals as number | null) : 1,
    },
    score: {
      halftime: { home: 2, away: 0 },
      fulltime: { home: 3, away: 1 },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
  };
}

function makeStandingEntry(overrides: Partial<ApiStandingEntry> = {}): ApiStandingEntry {
  return {
    rank: 1,
    team: { id: 40, name: "Liverpool", logo: "https://example.com/liv.png" },
    points: 84,
    goalsDiff: 45,
    form: "WDWWL",
    all: { played: 38, win: 25, draw: 9, lose: 4, goals: { for: 86, against: 41 } },
    home: { played: 19, win: 14, draw: 4, lose: 1, goals: { for: 42, against: 16 } },
    away: { played: 19, win: 11, draw: 5, lose: 3, goals: { for: 44, against: 25 } },
    ...overrides,
  };
}

describe("mapFixtureStatus", () => {
  test("maps scheduled statuses", () => {
    expect(mapFixtureStatus("NS")).toBe("scheduled");
    expect(mapFixtureStatus("TBD")).toBe("scheduled");
  });

  test("maps in_progress statuses", () => {
    expect(mapFixtureStatus("1H")).toBe("in_progress");
    expect(mapFixtureStatus("HT")).toBe("in_progress");
    expect(mapFixtureStatus("2H")).toBe("in_progress");
    expect(mapFixtureStatus("ET")).toBe("in_progress");
    expect(mapFixtureStatus("BT")).toBe("in_progress");
    expect(mapFixtureStatus("P")).toBe("in_progress");
    expect(mapFixtureStatus("LIVE")).toBe("in_progress");
  });

  test("maps finished statuses", () => {
    expect(mapFixtureStatus("FT")).toBe("finished");
    expect(mapFixtureStatus("AET")).toBe("finished");
    expect(mapFixtureStatus("PEN")).toBe("finished");
    expect(mapFixtureStatus("AWD")).toBe("finished");
    expect(mapFixtureStatus("WO")).toBe("finished");
  });

  test("maps postponed statuses", () => {
    expect(mapFixtureStatus("PST")).toBe("postponed");
    expect(mapFixtureStatus("SUSP")).toBe("postponed");
    expect(mapFixtureStatus("INT")).toBe("postponed");
  });

  test("maps cancelled statuses", () => {
    expect(mapFixtureStatus("CANC")).toBe("cancelled");
    expect(mapFixtureStatus("ABD")).toBe("cancelled");
  });

  test("defaults to scheduled for unknown codes", () => {
    expect(mapFixtureStatus("UNKNOWN")).toBe("scheduled");
    expect(mapFixtureStatus("")).toBe("scheduled");
  });
});

describe("mapApiFixtureToFixture", () => {
  test("maps all fields correctly", () => {
    const result = mapApiFixtureToFixture(makeApiFixture());

    expect(result.id).toBe(1208261);
    expect(result.league).toEqual({
      id: 39,
      name: "Premier League",
      country: "England",
      season: 2024,
    });
    expect(result.homeTeam).toEqual({
      id: 65,
      name: "Nottingham Forest",
      logo: "https://example.com/nf.png",
    });
    expect(result.awayTeam).toEqual({
      id: 51,
      name: "Brighton",
      logo: "https://example.com/bri.png",
    });
    expect(result.date).toBe("2025-02-01T12:30:00+00:00");
    expect(result.venue).toBe("The City Ground");
    expect(result.status).toBe("finished");
  });

  test("handles null venue", () => {
    const result = mapApiFixtureToFixture(makeApiFixture({ venueName: null }));
    expect(result.venue).toBeNull();
  });

  test("maps status correctly", () => {
    const scheduled = mapApiFixtureToFixture(makeApiFixture({ statusShort: "NS" }));
    expect(scheduled.status).toBe("scheduled");

    const inProgress = mapApiFixtureToFixture(makeApiFixture({ statusShort: "2H" }));
    expect(inProgress.status).toBe("in_progress");
  });
});

describe("mapStandingToTeamStats", () => {
  test("maps standings entry to TeamStats with home/away records", () => {
    const result = mapStandingToTeamStats(makeStandingEntry());

    expect(result.teamId).toBe(40);
    expect(result.teamName).toBe("Liverpool");
    expect(result.played).toBe(38);
    expect(result.wins).toBe(25);
    expect(result.draws).toBe(9);
    expect(result.losses).toBe(4);
    expect(result.goalsFor).toBe(86);
    expect(result.goalsAgainst).toBe(41);
    expect(result.goalDifference).toBe(45);
    expect(result.points).toBe(84);
    expect(result.form).toBe("WDWWL");

    expect(result.homeRecord).toEqual({
      played: 19,
      wins: 14,
      draws: 4,
      losses: 1,
      goalsFor: 42,
      goalsAgainst: 16,
    });
    expect(result.awayRecord).toEqual({
      played: 19,
      wins: 11,
      draws: 5,
      losses: 3,
      goalsFor: 44,
      goalsAgainst: 25,
    });
  });

  test("handles null form", () => {
    const result = mapStandingToTeamStats(makeStandingEntry({ form: null }));
    expect(result.form).toBeNull();
  });
});

describe("mapH2hFixturesToH2H", () => {
  test("counts wins/draws correctly when home team played at home", () => {
    const fixtures = [
      makeApiFixture({ homeId: 33, awayId: 34, homeGoals: 3, awayGoals: 1 }),
      makeApiFixture({ homeId: 33, awayId: 34, homeGoals: 1, awayGoals: 1 }),
      makeApiFixture({ homeId: 33, awayId: 34, homeGoals: 0, awayGoals: 2 }),
    ];

    const result = mapH2hFixturesToH2H(fixtures, 33);

    expect(result.totalMatches).toBe(3);
    expect(result.homeWins).toBe(1);
    expect(result.awayWins).toBe(1);
    expect(result.draws).toBe(1);
  });

  test("counts correctly when our home team played away in h2h fixture", () => {
    const fixtures = [makeApiFixture({ homeId: 34, awayId: 33, homeGoals: 0, awayGoals: 2 })];

    const result = mapH2hFixturesToH2H(fixtures, 33);

    expect(result.homeWins).toBe(1);
    expect(result.awayWins).toBe(0);
  });

  test("limits recentMatches to 10", () => {
    const fixtures = Array.from({ length: 15 }, (_, i) =>
      makeApiFixture({ fixtureId: i, homeGoals: 1, awayGoals: 0 }),
    );

    const result = mapH2hFixturesToH2H(fixtures, 65);

    expect(result.totalMatches).toBe(15);
    expect(result.recentMatches).toHaveLength(10);
  });

  test("skips fixtures with null goals", () => {
    const fixtures = [
      makeApiFixture({ homeGoals: 2, awayGoals: 1 }),
      makeApiFixture({ homeGoals: null, awayGoals: null }),
    ];

    const result = mapH2hFixturesToH2H(fixtures, 65);

    expect(result.totalMatches).toBe(2);
    expect(result.homeWins).toBe(1);
    expect(result.awayWins).toBe(0);
    expect(result.draws).toBe(0);
  });

  test("maps recentMatches with correct fields", () => {
    const fixtures = [
      makeApiFixture({
        homeName: "Man Utd",
        awayName: "Newcastle",
        homeGoals: 3,
        awayGoals: 2,
        date: "2025-01-15T15:00:00+00:00",
      }),
    ];

    const result = mapH2hFixturesToH2H(fixtures, 65);

    expect(result.recentMatches[0]).toEqual({
      date: "2025-01-15T15:00:00+00:00",
      homeTeam: "Man Utd",
      awayTeam: "Newcastle",
      homeGoals: 3,
      awayGoals: 2,
    });
  });
});
