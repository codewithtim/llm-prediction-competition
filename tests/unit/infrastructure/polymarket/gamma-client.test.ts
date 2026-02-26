import { afterEach, describe, expect, mock, test } from "bun:test";
import { createGammaClient } from "../../../../src/infrastructure/polymarket/gamma-client.ts";
import type { GammaEvent, GammaSport } from "../../../../src/infrastructure/polymarket/types.ts";

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

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createGammaClient", () => {
  describe("getSports", () => {
    test("returns parsed sports array", async () => {
      const fakeSports: GammaSport[] = [
        {
          id: 2,
          sport: "epl",
          image: "https://example.com/epl.jpg",
          resolution: "https://www.premierleague.com/",
          ordering: "home",
          tags: "1,82,306",
          series: "10188",
          createdAt: "2025-11-05T19:27:45Z",
        },
      ];

      mockFetch({ ok: true, status: 200, body: fakeSports });
      const client = createGammaClient();
      const result = await client.getSports();

      expect(result).toEqual(fakeSports);
      expect(fetchMock).toHaveBeenCalledWith("https://gamma-api.polymarket.com/sports");
    });

    test("throws on non-OK response", async () => {
      mockFetch({ ok: false, status: 500, body: {} });
      const client = createGammaClient();

      expect(client.getSports()).rejects.toThrow("Gamma /sports failed: 500");
    });
  });

  describe("getEvents", () => {
    test("builds correct URL query params", async () => {
      const fakeEvents: GammaEvent[] = [];
      mockFetch({ ok: true, status: 200, body: fakeEvents });
      const client = createGammaClient();

      await client.getEvents({ tag_id: 82, active: true, closed: false, limit: 10, offset: 0 });

      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("tag_id=82");
      expect(calledUrl).toContain("active=true");
      expect(calledUrl).toContain("closed=false");
      expect(calledUrl).toContain("limit=10");
      expect(calledUrl).toContain("offset=0");
    });

    test("returns parsed events array", async () => {
      const fakeEvents: GammaEvent[] = [
        {
          id: "218306",
          title: "Tottenham vs Crystal Palace",
          slug: "epl-tot-cry-2026-03-05",
          startDate: "2026-02-14T05:11:37Z",
          endDate: "2026-03-06T00:00:00Z",
          active: true,
          closed: false,
          seriesSlug: "premier-league-2025",
          eventDate: "2026-03-05",
          startTime: "2026-03-05T20:00:00Z",
          score: "",
          elapsed: "",
          period: "",
          markets: [],
        },
      ];

      mockFetch({ ok: true, status: 200, body: fakeEvents });
      const client = createGammaClient();
      const result = await client.getEvents({ tag_id: 82 });

      expect(result).toEqual(fakeEvents);
    });

    test("throws on non-OK response", async () => {
      mockFetch({ ok: false, status: 404, body: {} });
      const client = createGammaClient();

      expect(client.getEvents({ tag_id: 82 })).rejects.toThrow("Gamma /events failed: 404");
    });

    test("omits undefined params from query string", async () => {
      mockFetch({ ok: true, status: 200, body: [] });
      const client = createGammaClient();

      await client.getEvents({ tag_id: 82 });

      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("tag_id=82");
      expect(calledUrl).not.toContain("active=");
      expect(calledUrl).not.toContain("limit=");
    });
  });
});
