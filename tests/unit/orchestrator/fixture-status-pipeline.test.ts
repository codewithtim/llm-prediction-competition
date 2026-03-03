import { describe, expect, mock, test } from "bun:test";
import type { FootballClient } from "../../../src/infrastructure/sports-data/client.ts";
import type { ApiFixture, ApiResponse } from "../../../src/infrastructure/sports-data/types.ts";
import {
  createFixtureStatusPipeline,
  type FixtureStatusPipelineDeps,
} from "../../../src/orchestrator/fixture-status-pipeline.ts";

function apiResponse<T>(data: T): ApiResponse<T> {
  return {
    get: "",
    parameters: {},
    errors: [] as [],
    results: 1,
    paging: { current: 1, total: 1 },
    response: data,
  };
}

function makeApiFixture(id: number, statusShort: string): ApiFixture {
  return {
    fixture: {
      id,
      referee: null,
      timezone: "UTC",
      date: "2026-03-05T20:00:00Z",
      timestamp: 1772323200,
      venue: { id: 1, name: "Stadium", city: "London" },
      status: { long: "In Play", short: statusShort, elapsed: 45, extra: null },
    },
    league: {
      id: 39,
      name: "Premier League",
      country: "England",
      logo: "",
      flag: "",
      season: 2024,
      round: "Regular Season - 30",
    },
    teams: {
      home: { id: 10, name: "Team A", logo: "", winner: null },
      away: { id: 20, name: "Team B", logo: "", winner: null },
    },
    goals: { home: 1, away: 0 },
    score: {
      halftime: { home: 1, away: 0 },
      fulltime: { home: null, away: null },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
  };
}

function makeFixtureRow(
  id: number,
  status: string,
) {
  return {
    id,
    leagueId: 39,
    leagueName: "Premier League",
    leagueCountry: "England",
    leagueSeason: 2024,
    homeTeamId: 10,
    homeTeamName: "Team A",
    homeTeamLogo: null,
    awayTeamId: 20,
    awayTeamName: "Team B",
    awayTeamLogo: null,
    date: "2026-03-05T20:00:00Z",
    venue: "Stadium",
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function mockFootballClient(overrides: Partial<FootballClient> = {}): FootballClient {
  return {
    getFixtures: mock(() => Promise.resolve(apiResponse([]))),
    getLeagues: mock(() => Promise.resolve(apiResponse([]))),
    getStandings: mock(() => Promise.resolve(apiResponse([]))),
    getHeadToHead: mock(() => Promise.resolve(apiResponse([]))),
    getInjuries: mock(() => Promise.resolve(apiResponse([]))),
    getTeamStatistics: mock(() => Promise.resolve(apiResponse({} as never))),
    getPlayers: mock(() => Promise.resolve(apiResponse([]))),
    getAllPlayers: mock(() => Promise.resolve([])),
    ...overrides,
  };
}

function buildDeps(overrides: Partial<FixtureStatusPipelineDeps> = {}): FixtureStatusPipelineDeps {
  return {
    footballClient: mockFootballClient(),
    fixturesRepo: {
      findNeedingStatusUpdate: mock(() => Promise.resolve([])),
      updateStatus: mock(() => Promise.resolve()),
    } as never,
    ...overrides,
  };
}

describe("createFixtureStatusPipeline", () => {
  test("updates scheduled fixture to in_progress when API reports 1H", async () => {
    const findNeedingStatusUpdate = mock(() =>
      Promise.resolve([makeFixtureRow(100, "scheduled")]),
    );
    const updateStatus = mock(() => Promise.resolve());
    const getFixtures = mock(() =>
      Promise.resolve(apiResponse([makeApiFixture(100, "1H")])),
    );

    const pipeline = createFixtureStatusPipeline({
      footballClient: mockFootballClient({ getFixtures }),
      fixturesRepo: { findNeedingStatusUpdate, updateStatus } as never,
    });

    const result = await pipeline.run();

    expect(result.fixturesChecked).toBe(1);
    expect(result.statusesUpdated).toBe(1);
    expect(updateStatus).toHaveBeenCalledWith(100, "in_progress");
  });

  test("updates in_progress fixture to finished when API reports FT", async () => {
    const findNeedingStatusUpdate = mock(() =>
      Promise.resolve([makeFixtureRow(100, "in_progress")]),
    );
    const updateStatus = mock(() => Promise.resolve());
    const getFixtures = mock(() =>
      Promise.resolve(apiResponse([makeApiFixture(100, "FT")])),
    );

    const pipeline = createFixtureStatusPipeline({
      footballClient: mockFootballClient({ getFixtures }),
      fixturesRepo: { findNeedingStatusUpdate, updateStatus } as never,
    });

    const result = await pipeline.run();

    expect(result.fixturesChecked).toBe(1);
    expect(result.statusesUpdated).toBe(1);
    expect(updateStatus).toHaveBeenCalledWith(100, "finished");
  });

  test("skips update when status unchanged", async () => {
    const findNeedingStatusUpdate = mock(() =>
      Promise.resolve([makeFixtureRow(100, "in_progress")]),
    );
    const updateStatus = mock(() => Promise.resolve());
    const getFixtures = mock(() =>
      Promise.resolve(apiResponse([makeApiFixture(100, "2H")])),
    );

    const pipeline = createFixtureStatusPipeline({
      footballClient: mockFootballClient({ getFixtures }),
      fixturesRepo: { findNeedingStatusUpdate, updateStatus } as never,
    });

    const result = await pipeline.run();

    expect(result.fixturesChecked).toBe(1);
    expect(result.statusesUpdated).toBe(0);
    expect(updateStatus).not.toHaveBeenCalled();
  });

  test("handles API error gracefully and continues with other fixtures", async () => {
    const findNeedingStatusUpdate = mock(() =>
      Promise.resolve([makeFixtureRow(100, "scheduled"), makeFixtureRow(200, "in_progress")]),
    );
    const updateStatus = mock(() => Promise.resolve());
    let callCount = 0;
    const getFixtures = mock(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error("API timeout"));
      return Promise.resolve(apiResponse([makeApiFixture(200, "FT")]));
    });

    const pipeline = createFixtureStatusPipeline({
      footballClient: mockFootballClient({ getFixtures }),
      fixturesRepo: { findNeedingStatusUpdate, updateStatus } as never,
    });

    const result = await pipeline.run();

    expect(result.fixturesChecked).toBe(2);
    expect(result.statusesUpdated).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("API timeout");
    expect(updateStatus).toHaveBeenCalledWith(200, "finished");
  });

  test("handles empty API response without error", async () => {
    const findNeedingStatusUpdate = mock(() =>
      Promise.resolve([makeFixtureRow(100, "scheduled")]),
    );
    const updateStatus = mock(() => Promise.resolve());
    const getFixtures = mock(() => Promise.resolve(apiResponse([])));

    const pipeline = createFixtureStatusPipeline({
      footballClient: mockFootballClient({ getFixtures }),
      fixturesRepo: { findNeedingStatusUpdate, updateStatus } as never,
    });

    const result = await pipeline.run();

    expect(result.fixturesChecked).toBe(1);
    expect(result.statusesUpdated).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(updateStatus).not.toHaveBeenCalled();
  });
});
