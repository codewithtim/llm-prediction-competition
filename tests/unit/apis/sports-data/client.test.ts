import { afterEach, describe, expect, mock, test } from "bun:test";
import { createFootballClient } from "../../../../src/apis/sports-data/client.ts";

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof mock>;

function mockFetch(response: { ok: boolean; status: number; body: unknown }) {
  fetchMock = mock(() =>
    Promise.resolve({
      ok: response.ok,
      status: response.status,
      json: () => Promise.resolve(response.body),
    } as Response),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

const emptyResponse = {
  get: "",
  parameters: {},
  errors: [],
  results: 0,
  paging: { current: 1, total: 1 },
  response: [],
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createFootballClient", () => {
  describe("getFixtures", () => {
    test("builds correct URL with params and API key header", async () => {
      mockFetch({ ok: true, status: 200, body: emptyResponse });
      const client = createFootballClient("test-api-key");

      await client.getFixtures({ league: 39, season: 2024, from: "2025-02-01", to: "2025-02-05" });

      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("v3.football.api-sports.io/fixtures?");
      expect(calledUrl).toContain("league=39");
      expect(calledUrl).toContain("season=2024");
      expect(calledUrl).toContain("from=2025-02-01");
      expect(calledUrl).toContain("to=2025-02-05");

      const calledInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect((calledInit.headers as Record<string, string>)["x-apisports-key"]).toBe(
        "test-api-key",
      );
    });

    test("returns parsed response", async () => {
      mockFetch({ ok: true, status: 200, body: emptyResponse });
      const client = createFootballClient("test-api-key");

      const result = await client.getFixtures({ league: 39, season: 2024 });
      expect(result.response).toEqual([]);
    });
  });

  describe("getHeadToHead", () => {
    test("formats h2h param correctly", async () => {
      mockFetch({ ok: true, status: 200, body: emptyResponse });
      const client = createFootballClient("test-api-key");

      await client.getHeadToHead(33, 34);

      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("/fixtures/headtohead?");
      expect(calledUrl).toContain("h2h=33-34");
    });
  });

  describe("getStandings", () => {
    test("passes league and season params", async () => {
      mockFetch({ ok: true, status: 200, body: emptyResponse });
      const client = createFootballClient("test-api-key");

      await client.getStandings(39, 2024);

      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("/standings?");
      expect(calledUrl).toContain("league=39");
      expect(calledUrl).toContain("season=2024");
    });
  });

  describe("getInjuries", () => {
    test("builds correct URL with fixture param", async () => {
      mockFetch({ ok: true, status: 200, body: emptyResponse });
      const client = createFootballClient("test-api-key");

      await client.getInjuries(12345);

      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("/injuries?");
      expect(calledUrl).toContain("fixture=12345");
    });
  });

  describe("getTeamStatistics", () => {
    test("builds correct URL with team, league, season params", async () => {
      mockFetch({
        ok: true,
        status: 200,
        body: { ...emptyResponse, response: {} },
      });
      const client = createFootballClient("test-api-key");

      await client.getTeamStatistics(33, 39, 2024);

      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("/teams/statistics?");
      expect(calledUrl).toContain("team=33");
      expect(calledUrl).toContain("league=39");
      expect(calledUrl).toContain("season=2024");
    });

    test("includes date param when provided", async () => {
      mockFetch({
        ok: true,
        status: 200,
        body: { ...emptyResponse, response: {} },
      });
      const client = createFootballClient("test-api-key");

      await client.getTeamStatistics(33, 39, 2024, "2024-12-15");

      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("date=2024-12-15");
    });
  });

  describe("getPlayers", () => {
    test("builds correct URL with team, season, page params", async () => {
      mockFetch({ ok: true, status: 200, body: emptyResponse });
      const client = createFootballClient("test-api-key");

      await client.getPlayers({ team: 33, season: 2024, page: 2 });

      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("/players?");
      expect(calledUrl).toContain("team=33");
      expect(calledUrl).toContain("season=2024");
      expect(calledUrl).toContain("page=2");
    });
  });

  describe("getAllPlayers", () => {
    test("fetches multiple pages and returns combined results", async () => {
      const player1 = { player: { id: 1 } };
      const player2 = { player: { id: 2 } };

      let callCount = 0;
      fetchMock = mock(() => {
        callCount++;
        const body =
          callCount === 1
            ? { ...emptyResponse, paging: { current: 1, total: 2 }, response: [player1] }
            : { ...emptyResponse, paging: { current: 2, total: 2 }, response: [player2] };
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(body),
        } as Response);
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const client = createFootballClient("test-api-key");
      const result = await client.getAllPlayers(33, 2024);

      expect(result).toHaveLength(2);
      expect(result[0]?.player.id).toBe(1);
      expect(result[1]?.player.id).toBe(2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("error handling", () => {
    test("throws on non-OK response", async () => {
      mockFetch({ ok: false, status: 500, body: {} });
      const client = createFootballClient("test-api-key");

      expect(client.getFixtures({ league: 39 })).rejects.toThrow(
        "API-Football /fixtures failed (HTTP 500)",
      );
    });

    test("throws with correct path for standings", async () => {
      mockFetch({ ok: false, status: 403, body: {} });
      const client = createFootballClient("test-api-key");

      expect(client.getStandings(39, 2024)).rejects.toThrow("API-Football /standings failed (HTTP 403)");
    });
  });
});
