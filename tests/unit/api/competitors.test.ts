import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { competitorsRoutes } from "../../../src/api/routes/competitors";
import { createMockDeps } from "./helpers";

const sampleCompetitor = {
  id: "c1",
  name: "Claude",
  model: "claude-4",
  status: "active",
  type: "weight-tuned",
  enginePath: "src/competitors/claude/engine.ts",
  config: null,
  createdAt: new Date("2026-01-01"),
};

describe("GET /api/competitors", () => {
  test("returns all competitors with stats", async () => {
    const deps = createMockDeps({
      competitorsRepo: {
        findAll: async () => [sampleCompetitor],
      } as any,
      walletsRepo: {
        listAll: async () => [{ competitorId: "c1", walletAddress: "0xabc" }],
      } as any,
      betsRepo: {
        getPerformanceStats: async () => ({
          competitorId: "c1",
          totalBets: 5,
          wins: 3,
          losses: 1,
          pending: 1,
          totalStaked: 50,
          totalReturned: 65,
          profitLoss: 15,
          accuracy: 0.75,
          roi: 0.3,
        }),
      } as any,
    });

    const app = new Hono();
    app.route("/api", competitorsRoutes(deps));

    const res = await app.request("/api/competitors");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("Claude");
    expect(data[0].hasWallet).toBe(true);
    expect(data[0].walletAddress).toBe("0xabc");
    expect(data[0].stats.wins).toBe(3);
  });

  test("filters by status", async () => {
    const deps = createMockDeps({
      competitorsRepo: {
        findByStatus: async (status: string) =>
          status === "active" ? [sampleCompetitor] : [],
      } as any,
      walletsRepo: { listAll: async () => [] } as any,
      betsRepo: {
        getPerformanceStats: async () => ({
          competitorId: "c1", totalBets: 0, wins: 0, losses: 0, pending: 0,
          totalStaked: 0, totalReturned: 0, profitLoss: 0, accuracy: 0, roi: 0,
        }),
      } as any,
    });

    const app = new Hono();
    app.route("/api", competitorsRoutes(deps));

    const res = await app.request("/api/competitors?status=active");
    const data = await res.json();
    expect(data).toHaveLength(1);
  });
});

describe("GET /api/competitors/:id", () => {
  test("returns competitor detail", async () => {
    const deps = createMockDeps({
      competitorsRepo: {
        findById: async () => sampleCompetitor,
        findAll: async () => [sampleCompetitor],
      } as any,
      walletsRepo: { listAll: async () => [] } as any,
      betsRepo: {
        getPerformanceStats: async () => ({
          competitorId: "c1", totalBets: 0, wins: 0, losses: 0, pending: 0,
          totalStaked: 0, totalReturned: 0, profitLoss: 0, accuracy: 0, roi: 0,
        }),
        findByCompetitor: async () => [],
      } as any,
      competitorVersionsRepo: { findByCompetitor: async () => [] } as any,
      predictionsRepo: { findByCompetitor: async () => [] } as any,
    });

    const app = new Hono();
    app.route("/api", competitorsRoutes(deps));

    const res = await app.request("/api/competitors/c1");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.name).toBe("Claude");
    expect(data.versions).toEqual([]);
  });

  test("returns 404 for missing competitor", async () => {
    const deps = createMockDeps();

    const app = new Hono();
    app.route("/api", competitorsRoutes(deps));

    const res = await app.request("/api/competitors/nonexistent");
    expect(res.status).toBe(404);
  });
});
