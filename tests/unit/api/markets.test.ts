import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { marketsRoutes } from "../../../src/api/routes/markets";
import { createMockDeps } from "./helpers";

describe("GET /api/markets", () => {
  test("returns all markets with fixture summary", async () => {
    const deps = createMockDeps({
      marketsRepo: {
        findAll: async () => [
          {
            id: "m1",
            question: "Will Arsenal win?",
            outcomes: ["Yes", "No"],
            outcomePrices: ["0.65", "0.35"],
            active: true,
            closed: false,
            liquidity: 50000,
            volume: 120000,
            fixtureId: 1001,
            sportsMarketType: "moneyline",
          },
        ],
      } as any,
      fixturesRepo: {
        findAll: async () => [{ id: 1001, homeTeamName: "Arsenal", awayTeamName: "Chelsea" }],
      } as any,
    });

    const app = new Hono();
    app.route("/api", marketsRoutes(deps));

    const res = await app.request("/api/markets");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].fixtureSummary).toBe("Arsenal vs Chelsea");
    expect(data[0].status).toBe("active");
  });

  test("filters by active flag", async () => {
    const deps = createMockDeps({
      marketsRepo: {
        findAll: async () => [
          { id: "m1", active: true, closed: false, fixtureId: null },
          { id: "m2", active: false, closed: true, fixtureId: null },
        ],
      } as any,
      fixturesRepo: { findAll: async () => [] } as any,
    });

    const app = new Hono();
    app.route("/api", marketsRoutes(deps));

    const res = await app.request("/api/markets?active=true");
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("m1");
  });
});
