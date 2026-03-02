import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { fixturesRoutes } from "../../../src/api/routes/fixtures";
import { createMockDeps } from "./helpers";

const sampleFixture = {
  id: 1001,
  leagueId: 39,
  leagueName: "Premier League",
  leagueCountry: "England",
  leagueSeason: 2025,
  homeTeamId: 42,
  homeTeamName: "Arsenal",
  homeTeamLogo: null,
  awayTeamId: 49,
  awayTeamName: "Chelsea",
  awayTeamLogo: null,
  date: "2026-03-15",
  venue: "Emirates Stadium",
  status: "scheduled",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("GET /api/fixtures", () => {
  test("returns fixtures with market counts", async () => {
    const deps = createMockDeps({
      fixturesRepo: { findAll: async () => [sampleFixture] } as any,
      marketsRepo: {
        findAll: async () => [
          { id: "m1", fixtureId: 1001 },
          { id: "m2", fixtureId: 1001 },
        ],
      } as any,
    });

    const app = new Hono();
    app.route("/api", fixturesRoutes(deps));

    const res = await app.request("/api/fixtures");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].homeTeamName).toBe("Arsenal");
    expect(data[0].marketCount).toBe(2);
  });
});

describe("GET /api/fixtures/:id", () => {
  test("returns fixture detail with markets and predictions", async () => {
    const deps = createMockDeps({
      fixturesRepo: { findById: async () => sampleFixture } as any,
      marketsRepo: {
        findByFixtureId: async () => [
          {
            id: "m1", question: "Will Arsenal win?", outcomes: ["Yes", "No"],
            outcomePrices: ["0.65", "0.35"], active: true, closed: false,
            liquidity: 50000, volume: 120000, fixtureId: 1001,
            sportsMarketType: "moneyline",
          },
        ],
      } as any,
      predictionsRepo: { findAll: async () => [] } as any,
      competitorsRepo: { findAll: async () => [] } as any,
    });

    const app = new Hono();
    app.route("/api", fixturesRoutes(deps));

    const res = await app.request("/api/fixtures/1001");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.homeTeamName).toBe("Arsenal");
    expect(data.markets).toHaveLength(1);
  });

  test("returns 404 for missing fixture", async () => {
    const deps = createMockDeps();

    const app = new Hono();
    app.route("/api", fixturesRoutes(deps));

    const res = await app.request("/api/fixtures/9999");
    expect(res.status).toBe(404);
  });
});
