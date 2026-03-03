import { describe, expect, test } from "bun:test";
import {
  mapApiFixtureToFixture,
  mapApiInjuries,
  mapApiPlayerToPlayerStats,
  mapApiTeamStatistics,
  mapFixtureStatus,
  mapH2hFixturesToH2H,
  mapStandingToTeamStats,
} from "../../../../src/infrastructure/sports-data/mappers.ts";
import type {
  ApiFixture,
  ApiInjury,
  ApiPlayerResponse,
  ApiStandingEntry,
  ApiTeamStatisticsResponse,
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

// ─── New Enrichment Mapper Tests ─────────────────────────────────────

function makeApiInjury(overrides: Partial<ApiInjury> = {}): ApiInjury {
  return {
    player: {
      id: 100,
      name: "Mohamed Salah",
      photo: "https://example.com/salah.png",
      type: "Missing Fixture",
      reason: "Knee Injury",
    },
    team: { id: 40, name: "Liverpool", logo: "https://example.com/liv.png" },
    fixture: { id: 1234, timezone: "UTC", date: "2025-02-01T15:00:00+00:00", timestamp: 1738418400 },
    league: { id: 39, season: 2024, name: "Premier League", country: "England" },
    ...overrides,
  };
}

function makeApiTeamStats(): ApiTeamStatisticsResponse {
  const minuteEntry = (total: number | null, pct: string | null) => ({ total, percentage: pct });
  return {
    league: { id: 39, name: "Premier League", country: "England", season: 2024 },
    team: { id: 40, name: "Liverpool", logo: "" },
    form: "WWDLW",
    fixtures: {
      played: { home: 10, away: 10, total: 20 },
      wins: { home: 7, away: 5, total: 12 },
      draws: { home: 2, away: 3, total: 5 },
      loses: { home: 1, away: 2, total: 3 },
    },
    goals: {
      for: {
        total: { home: 22, away: 15, total: 37 },
        average: { home: "2.2", away: "1.5", total: "1.85" },
        minute: {
          "0-15": minuteEntry(5, "13.5%"),
          "16-30": minuteEntry(7, "18.9%"),
          "31-45": minuteEntry(4, "10.8%"),
          "46-60": minuteEntry(6, "16.2%"),
          "61-75": minuteEntry(8, "21.6%"),
          "76-90": minuteEntry(5, "13.5%"),
          "91-105": minuteEntry(2, "5.4%"),
          "106-120": minuteEntry(null, null),
        },
        under_over: {
          "0.5": { over: 18, under: 2 },
          "1.5": { over: 15, under: 5 },
          "2.5": { over: 10, under: 10 },
          "3.5": { over: 5, under: 15 },
          "4.5": { over: 2, under: 18 },
        },
      },
      against: {
        total: { home: 8, away: 12, total: 20 },
        average: { home: "0.8", away: "1.2", total: "1.0" },
        minute: {
          "0-15": minuteEntry(3, "15%"),
          "16-30": minuteEntry(4, "20%"),
          "31-45": minuteEntry(3, "15%"),
          "46-60": minuteEntry(3, "15%"),
          "61-75": minuteEntry(4, "20%"),
          "76-90": minuteEntry(2, "10%"),
          "91-105": minuteEntry(1, "5%"),
          "106-120": minuteEntry(null, null),
        },
        under_over: {
          "0.5": { over: 14, under: 6 },
          "1.5": { over: 8, under: 12 },
          "2.5": { over: 3, under: 17 },
          "3.5": { over: 1, under: 19 },
          "4.5": { over: 0, under: 20 },
        },
      },
    },
    biggest: {
      streak: { wins: 5, draws: 2, loses: 1 },
      wins: { home: "4-0", away: "0-3" },
      loses: { home: "0-2", away: "3-0" },
      goals: { for: { home: 4, away: 3 }, against: { home: 2, away: 3 } },
    },
    clean_sheet: { home: 6, away: 3, total: 9 },
    failed_to_score: { home: 1, away: 3, total: 4 },
    penalty: {
      scored: { total: 4, percentage: "80%" },
      missed: { total: 1, percentage: "20%" },
      total: 5,
    },
    lineups: [
      { formation: "4-3-3", played: 12 },
      { formation: "4-2-3-1", played: 8 },
    ],
    cards: {
      yellow: { "0-15": { total: 2, percentage: "5%" } },
      red: { "0-15": { total: null, percentage: null } },
    },
  };
}

function makeApiPlayerResponse(overrides: {
  playerId?: number;
  name?: string;
  leagueId?: number;
  rating?: string | null;
  appearances?: number | null;
  injured?: boolean;
} = {}): ApiPlayerResponse {
  return {
    player: {
      id: overrides.playerId ?? 200,
      name: overrides.name ?? "Virgil van Dijk",
      firstname: "Virgil",
      lastname: "van Dijk",
      age: 32,
      nationality: "Netherlands",
      height: "193 cm",
      weight: "92 kg",
      injured: overrides.injured ?? false,
      photo: "https://example.com/vvd.png",
    },
    statistics: [
      {
        team: { id: 40, name: "Liverpool", logo: "" },
        league: { id: overrides.leagueId ?? 39, name: "Premier League", country: "England", season: 2024 },
        games: {
          appearences: overrides.appearances ?? 18,
          lineups: 18,
          minutes: 1620,
          number: 4,
          position: "Defender",
          rating: overrides.rating !== undefined ? overrides.rating : "7.45",
          captain: true,
        },
        substitutes: { in: 0, out: 1, bench: 2 },
        shots: { total: 12, on: 5 },
        goals: { total: 3, conceded: null, assists: 1, saves: null },
        passes: { total: 1400, key: 8, accuracy: 91 },
        tackles: { total: 30, blocks: 15, interceptions: 25 },
        duels: { total: 100, won: 70 },
        dribbles: { attempts: 5, success: 3, past: null },
        fouls: { drawn: 10, committed: 8 },
        cards: { yellow: 3, yellowred: 0, red: 0 },
        penalty: { won: null, commited: null, scored: 0, missed: 0, saved: null },
      },
    ],
  };
}

describe("mapApiInjuries", () => {
  test("maps injury list correctly", () => {
    const injuries = [
      makeApiInjury(),
      makeApiInjury({
        player: {
          id: 101,
          name: "Darwin Nunez",
          photo: "",
          type: "Questionable",
          reason: "Illness",
        },
        team: { id: 40, name: "Liverpool", logo: "" },
      }),
    ];

    const result = mapApiInjuries(injuries);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      playerId: 100,
      playerName: "Mohamed Salah",
      type: "Missing Fixture",
      reason: "Knee Injury",
      teamId: 40,
    });
    expect(result[1]).toEqual({
      playerId: 101,
      playerName: "Darwin Nunez",
      type: "Questionable",
      reason: "Illness",
      teamId: 40,
    });
  });

  test("returns empty array for empty input", () => {
    expect(mapApiInjuries([])).toEqual([]);
  });
});

describe("mapApiTeamStatistics", () => {
  test("maps clean sheets, failed to score, biggest streak", () => {
    const result = mapApiTeamStatistics(makeApiTeamStats());

    expect(result.cleanSheets).toEqual({ home: 6, away: 3, total: 9 });
    expect(result.failedToScore).toEqual({ home: 1, away: 3, total: 4 });
    expect(result.biggestStreak).toEqual({ wins: 5, draws: 2, loses: 1 });
  });

  test("maps fixtures.played correctly", () => {
    const result = mapApiTeamStatistics(makeApiTeamStats());
    expect(result.fixtures.played).toEqual({ home: 10, away: 10, total: 20 });
  });

  test("maps goals by minute including null interval", () => {
    const result = mapApiTeamStatistics(makeApiTeamStats());

    expect(result.goalsForByMinute["0-15"]).toEqual({ total: 5, percentage: "13.5%" });
    expect(result.goalsForByMinute["106-120"]).toEqual({ total: null, percentage: null });
  });

  test("defaults missing minute interval to null", () => {
    const raw = makeApiTeamStats();
    // Remove a key from the goals.for.minute to simulate missing data
    const { "91-105": _, ...remainingMinute } = raw.goals.for.minute;
    raw.goals.for.minute = remainingMinute;

    const result = mapApiTeamStatistics(raw);
    expect(result.goalsForByMinute["91-105"]).toEqual({ total: null, percentage: null });
  });

  test("maps under/over data", () => {
    const result = mapApiTeamStatistics(makeApiTeamStats());

    expect(result.goalsForUnderOver["2.5"]).toEqual({ over: 10, under: 10 });
    expect(result.goalsAgainstUnderOver["4.5"]).toEqual({ over: 0, under: 20 });
  });

  test("defaults missing under/over line to zero", () => {
    const raw = makeApiTeamStats();
    const { "4.5": _, ...remainingLines } = raw.goals.for.under_over;
    raw.goals.for.under_over = remainingLines;

    const result = mapApiTeamStatistics(raw);
    expect(result.goalsForUnderOver["4.5"]).toEqual({ over: 0, under: 0 });
  });

  test("maps preferred formations", () => {
    const result = mapApiTeamStatistics(makeApiTeamStats());
    expect(result.preferredFormations).toEqual([
      { formation: "4-3-3", played: 12 },
      { formation: "4-2-3-1", played: 8 },
    ]);
  });

  test("maps penalty record", () => {
    const result = mapApiTeamStatistics(makeApiTeamStats());
    expect(result.penaltyRecord).toEqual({ scored: 4, missed: 1, total: 5 });
  });
});

describe("mapApiPlayerToPlayerStats", () => {
  test("maps player stats for correct league", () => {
    const result = mapApiPlayerToPlayerStats(makeApiPlayerResponse(), 39);

    expect(result).not.toBeNull();
    expect(result?.playerId).toBe(200);
    expect(result?.name).toBe("Virgil van Dijk");
    expect(result?.position).toBe("Defender");
    expect(result?.rating).toBeCloseTo(7.45);
    expect(result?.appearances).toBe(18);
    expect(result?.minutes).toBe(1620);
    expect(result?.goals).toBe(3);
    expect(result?.assists).toBe(1);
    expect(result?.shotsTotal).toBe(12);
    expect(result?.shotsOnTarget).toBe(5);
    expect(result?.passesKey).toBe(8);
    expect(result?.passAccuracy).toBe(91);
    expect(result?.dribblesSuccess).toBe(3);
    expect(result?.dribblesAttempts).toBe(5);
    expect(result?.yellowCards).toBe(3);
    expect(result?.redCards).toBe(0);
    expect(result?.injured).toBe(false);
  });

  test("returns null when league not found in player stats", () => {
    const result = mapApiPlayerToPlayerStats(makeApiPlayerResponse({ leagueId: 39 }), 140);
    expect(result).toBeNull();
  });

  test("handles null rating and null appearances", () => {
    const raw = makeApiPlayerResponse({ rating: null });
    raw.statistics[0]!.games.appearences = null;

    const result = mapApiPlayerToPlayerStats(raw, 39);

    expect(result).not.toBeNull();
    expect(result?.rating).toBeNull();
    expect(result?.appearances).toBe(0);
  });
});
