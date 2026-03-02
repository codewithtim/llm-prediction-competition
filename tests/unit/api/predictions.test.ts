import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { predictionsRoutes } from "../../../src/api/routes/predictions";
import { createMockDeps } from "./helpers";

describe("GET /api/predictions", () => {
  test("returns enriched predictions", async () => {
    const deps = createMockDeps({
      predictionsRepo: {
        findAll: async () => [
          {
            id: 1,
            competitorId: "c1",
            marketId: "m1",
            fixtureId: 1001,
            side: "YES",
            confidence: 0.75,
            stake: 5,
            reasoning: {
              summary: "Strong form",
              sections: [{ label: "Analysis", content: "Strong form" }],
            },
            createdAt: new Date("2026-01-01"),
          },
        ],
      } as any,
      competitorsRepo: {
        findAll: async () => [{ id: "c1", name: "Claude" }],
      } as any,
      marketsRepo: {
        findAll: async () => [{ id: "m1", question: "Will Arsenal win?" }],
      } as any,
    });

    const app = new Hono();
    app.route("/api", predictionsRoutes(deps));

    const res = await app.request("/api/predictions");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].competitorName).toBe("Claude");
    expect(data[0].marketQuestion).toBe("Will Arsenal win?");
    expect(data[0].confidence).toBe(0.75);
  });

  test("filters by competitorId", async () => {
    const deps = createMockDeps({
      predictionsRepo: {
        findAll: async () => [
          { id: 1, competitorId: "c1", marketId: "m1", createdAt: new Date() },
          { id: 2, competitorId: "c2", marketId: "m1", createdAt: new Date() },
        ],
      } as any,
      competitorsRepo: {
        findAll: async () => [
          { id: "c1", name: "Claude" },
          { id: "c2", name: "GPT" },
        ],
      } as any,
      marketsRepo: { findAll: async () => [{ id: "m1", question: "Q" }] } as any,
    });

    const app = new Hono();
    app.route("/api", predictionsRoutes(deps));

    const res = await app.request("/api/predictions?competitorId=c1");
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].competitorName).toBe("Claude");
  });
});
