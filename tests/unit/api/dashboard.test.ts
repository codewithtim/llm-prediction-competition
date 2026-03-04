import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { dashboardRoutes } from "../../../src/api/routes/dashboard";
import { createMockDeps } from "./helpers";

describe("GET /api/dashboard", () => {
  test("returns aggregated dashboard data", async () => {
    const deps = createMockDeps({
      competitorsRepo: {
        findAll: async () => [
          {
            id: "c1",
            name: "Claude",
            model: "claude-4",
            status: "active",
            type: "weight-tuned",
            createdAt: new Date(),
          },
        ],
      } as any,
      fixturesRepo: {
        findAll: async () => [{ id: 1 }],
      } as any,
      marketsRepo: {
        findAll: async () => [{ id: "m1", active: true }],
      } as any,
      betsRepo: {
        findAll: async () => [{ id: "b1", status: "pending" }],
        findRecent: async () => [],
        getAllPerformanceStats: async () =>
          new Map([
            [
              "c1",
              {
                competitorId: "c1",
                totalBets: 1,
                wins: 0,
                losses: 0,
                pending: 1,
                failed: 0,
                lockedAmount: 10,
                totalStaked: 10,
                totalReturned: 0,
                profitLoss: -10,
                accuracy: 0,
                roi: -1,
              },
            ],
          ]),
      } as any,
      walletsRepo: {
        listAll: async () => [{ competitorId: "c1", walletAddress: "0x123" }],
      } as any,
    });

    const app = new Hono();
    app.route("/api", dashboardRoutes(deps));

    const res = await app.request("/api/dashboard");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.totalCompetitors).toBe(1);
    expect(data.activeCompetitors).toBe(1);
    expect(data.totalMarkets).toBe(1);
    expect(data.activeMarkets).toBe(1);
    expect(data.totalBets).toBe(1);
    expect(data.pendingBets).toBe(1);
    expect(data.leaderboard).toHaveLength(1);
    expect(data.leaderboard[0].rank).toBe(1);
    expect(data.leaderboard[0].competitor.name).toBe("Claude");
  });

  test("returns confidence in recentBets", async () => {
    const deps = createMockDeps({
      competitorsRepo: {
        findAll: async () => [
          { id: "c1", name: "Claude", model: "claude-4", status: "active", type: "weight-tuned", createdAt: new Date() },
        ],
      } as any,
      fixturesRepo: { findAll: async () => [] } as any,
      marketsRepo: {
        findAll: async () => [{ id: "m1", active: true, question: "Q" }],
      } as any,
      betsRepo: {
        findAll: async () => [],
        findRecent: async () => [
          { id: "b1", competitorId: "c1", marketId: "m1", fixtureId: 1, side: "YES", amount: 10, price: 0.6, shares: 16, status: "pending", placedAt: new Date(), settledAt: null, profit: null },
        ],
        getAllPerformanceStats: async () =>
          new Map([
            ["c1", { competitorId: "c1", totalBets: 1, wins: 0, losses: 0, pending: 1, failed: 0, lockedAmount: 10, totalStaked: 0, totalReturned: 0, profitLoss: 0, accuracy: 0, roi: 0 }],
          ]),
      } as any,
      predictionsRepo: {
        findAll: async () => [
          { competitorId: "c1", marketId: "m1", side: "YES", confidence: 0.75 },
        ],
      } as any,
      walletsRepo: { listAll: async () => [] } as any,
    });

    const app = new Hono();
    app.route("/api", dashboardRoutes(deps));

    const res = await app.request("/api/dashboard");
    const data = await res.json();
    expect(data.recentBets).toHaveLength(1);
    expect(data.recentBets[0].confidence).toBe(0.75);
  });

  test("returns null confidence when no prediction matches", async () => {
    const deps = createMockDeps({
      competitorsRepo: {
        findAll: async () => [
          { id: "c1", name: "Claude", model: "claude-4", status: "active", type: "weight-tuned", createdAt: new Date() },
        ],
      } as any,
      fixturesRepo: { findAll: async () => [] } as any,
      marketsRepo: {
        findAll: async () => [{ id: "m1", active: true, question: "Q" }],
      } as any,
      betsRepo: {
        findAll: async () => [],
        findRecent: async () => [
          { id: "b1", competitorId: "c1", marketId: "m1", fixtureId: 1, side: "YES", amount: 10, price: 0.6, shares: 16, status: "pending", placedAt: new Date(), settledAt: null, profit: null },
        ],
        getAllPerformanceStats: async () =>
          new Map([
            ["c1", { competitorId: "c1", totalBets: 1, wins: 0, losses: 0, pending: 1, failed: 0, lockedAmount: 10, totalStaked: 0, totalReturned: 0, profitLoss: 0, accuracy: 0, roi: 0 }],
          ]),
      } as any,
      predictionsRepo: {
        findAll: async () => [],
      } as any,
      walletsRepo: { listAll: async () => [] } as any,
    });

    const app = new Hono();
    app.route("/api", dashboardRoutes(deps));

    const res = await app.request("/api/dashboard");
    const data = await res.json();
    expect(data.recentBets).toHaveLength(1);
    expect(data.recentBets[0].confidence).toBeNull();
  });

  test("returns empty data when no records exist", async () => {
    const deps = createMockDeps();

    const app = new Hono();
    app.route("/api", dashboardRoutes(deps));

    const res = await app.request("/api/dashboard");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.totalCompetitors).toBe(0);
    expect(data.leaderboard).toHaveLength(0);
    expect(data.recentBets).toHaveLength(0);
  });
});
