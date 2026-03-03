import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { betsRoutes } from "../../../src/api/routes/bets";
import { createMockDeps } from "./helpers";

describe("GET /api/bets", () => {
  test("returns enriched bets", async () => {
    const deps = createMockDeps({
      betsRepo: {
        findAll: async () => [
          {
            id: "b1",
            competitorId: "c1",
            marketId: "m1",
            fixtureId: 1001,
            side: "YES",
            amount: 10,
            price: 0.65,
            shares: 15.38,
            status: "pending",
            placedAt: new Date("2026-01-01"),
            settledAt: null,
            profit: null,
            errorMessage: null,
            errorCategory: null,
            attempts: 0,
          },
        ],
      } as any,
      competitorsRepo: {
        findAll: async () => [{ id: "c1", name: "Claude" }],
      } as any,
      marketsRepo: {
        findAll: async () => [
          {
            id: "m1",
            polymarketUrl: "https://polymarket.com/sports/epl/epl-ars-che-2026-03-15",
            question: "Will Arsenal win?",
          },
        ],
      } as any,
    });

    const app = new Hono();
    app.route("/api", betsRoutes(deps));

    const res = await app.request("/api/bets");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].competitorName).toBe("Claude");
    expect(data[0].marketQuestion).toBe("Will Arsenal win?");
    expect(data[0].polymarketUrl).toBe("https://polymarket.com/sports/epl/epl-ars-che-2026-03-15");
    expect(data[0].errorMessage).toBeNull();
    expect(data[0].errorCategory).toBeNull();
    expect(data[0].attempts).toBe(0);
  });

  test("returns error fields for failed bets", async () => {
    const deps = createMockDeps({
      betsRepo: {
        findAll: async () => [
          {
            id: "b1",
            competitorId: "c1",
            marketId: "m1",
            fixtureId: 1001,
            side: "YES",
            amount: 10,
            price: 0.65,
            shares: 0,
            status: "failed",
            placedAt: new Date("2026-01-01"),
            settledAt: null,
            profit: null,
            errorMessage: "insufficient balance",
            errorCategory: "insufficient_funds",
            attempts: 3,
          },
        ],
      } as any,
      competitorsRepo: {
        findAll: async () => [{ id: "c1", name: "Claude" }],
      } as any,
      marketsRepo: {
        findAll: async () => [
          {
            id: "m1",
            polymarketUrl: "https://polymarket.com/sports/epl/epl-ars-che-2026-03-15",
            question: "Will Arsenal win?",
          },
        ],
      } as any,
    });

    const app = new Hono();
    app.route("/api", betsRoutes(deps));

    const res = await app.request("/api/bets");
    const data = await res.json();
    expect(data[0].errorMessage).toBe("insufficient balance");
    expect(data[0].errorCategory).toBe("insufficient_funds");
    expect(data[0].attempts).toBe(3);
  });

  test("returns confidence from matching prediction", async () => {
    const deps = createMockDeps({
      betsRepo: {
        findAll: async () => [
          {
            id: "b1",
            competitorId: "c1",
            marketId: "m1",
            fixtureId: 1001,
            side: "YES",
            amount: 10,
            price: 0.65,
            shares: 15.38,
            status: "pending",
            placedAt: new Date("2026-01-01"),
            settledAt: null,
            profit: null,
          },
        ],
      } as any,
      competitorsRepo: {
        findAll: async () => [{ id: "c1", name: "Claude" }],
      } as any,
      marketsRepo: {
        findAll: async () => [{ id: "m1", question: "Will Arsenal win?" }],
      } as any,
      predictionsRepo: {
        findAll: async () => [
          { competitorId: "c1", marketId: "m1", side: "YES", confidence: 0.82 },
        ],
      } as any,
    });

    const app = new Hono();
    app.route("/api", betsRoutes(deps));

    const res = await app.request("/api/bets");
    const data = await res.json();
    expect(data[0].confidence).toBe(0.82);
  });

  test("returns null confidence when no prediction matches", async () => {
    const deps = createMockDeps({
      betsRepo: {
        findAll: async () => [
          {
            id: "b1",
            competitorId: "c1",
            marketId: "m1",
            fixtureId: 1001,
            side: "YES",
            amount: 10,
            price: 0.65,
            shares: 15.38,
            status: "pending",
            placedAt: new Date("2026-01-01"),
            settledAt: null,
            profit: null,
          },
        ],
      } as any,
      competitorsRepo: {
        findAll: async () => [{ id: "c1", name: "Claude" }],
      } as any,
      marketsRepo: {
        findAll: async () => [{ id: "m1", question: "Will Arsenal win?" }],
      } as any,
      predictionsRepo: {
        findAll: async () => [],
      } as any,
    });

    const app = new Hono();
    app.route("/api", betsRoutes(deps));

    const res = await app.request("/api/bets");
    const data = await res.json();
    expect(data[0].confidence).toBeNull();
  });

  test("returns null confidence when prediction side does not match", async () => {
    const deps = createMockDeps({
      betsRepo: {
        findAll: async () => [
          {
            id: "b1",
            competitorId: "c1",
            marketId: "m1",
            fixtureId: 1001,
            side: "YES",
            amount: 10,
            price: 0.65,
            shares: 15.38,
            status: "pending",
            placedAt: new Date("2026-01-01"),
            settledAt: null,
            profit: null,
          },
        ],
      } as any,
      competitorsRepo: {
        findAll: async () => [{ id: "c1", name: "Claude" }],
      } as any,
      marketsRepo: {
        findAll: async () => [{ id: "m1", question: "Will Arsenal win?" }],
      } as any,
      predictionsRepo: {
        findAll: async () => [
          { competitorId: "c1", marketId: "m1", side: "NO", confidence: 0.82 },
        ],
      } as any,
    });

    const app = new Hono();
    app.route("/api", betsRoutes(deps));

    const res = await app.request("/api/bets");
    const data = await res.json();
    expect(data[0].confidence).toBeNull();
  });

  test("filters by errorCategory", async () => {
    const deps = createMockDeps({
      betsRepo: {
        findAll: async () => [
          { id: "b1", status: "failed", competitorId: "c1", marketId: "m1", placedAt: new Date(), errorCategory: "insufficient_funds", errorMessage: "no funds", attempts: 2 },
          { id: "b2", status: "failed", competitorId: "c1", marketId: "m1", placedAt: new Date(), errorCategory: "network_error", errorMessage: "timeout", attempts: 1 },
          { id: "b3", status: "failed", competitorId: "c1", marketId: "m1", placedAt: new Date(), errorCategory: "insufficient_funds", errorMessage: "no funds", attempts: 1 },
        ],
      } as any,
      competitorsRepo: { findAll: async () => [{ id: "c1", name: "Claude" }] } as any,
      marketsRepo: { findAll: async () => [{ id: "m1", question: "Q" }] } as any,
    });

    const app = new Hono();
    app.route("/api", betsRoutes(deps));

    const res = await app.request("/api/bets?errorCategory=insufficient_funds");
    const data = await res.json();
    expect(data).toHaveLength(2);
    expect(data[0].id).toBe("b1");
    expect(data[1].id).toBe("b3");
  });

  test("returns all bets when no errorCategory filter", async () => {
    const deps = createMockDeps({
      betsRepo: {
        findAll: async () => [
          { id: "b1", status: "failed", competitorId: "c1", marketId: "m1", placedAt: new Date(), errorCategory: "insufficient_funds", errorMessage: "no funds", attempts: 1 },
          { id: "b2", status: "failed", competitorId: "c1", marketId: "m1", placedAt: new Date(), errorCategory: "network_error", errorMessage: "timeout", attempts: 1 },
        ],
      } as any,
      competitorsRepo: { findAll: async () => [{ id: "c1", name: "Claude" }] } as any,
      marketsRepo: { findAll: async () => [{ id: "m1", question: "Q" }] } as any,
    });

    const app = new Hono();
    app.route("/api", betsRoutes(deps));

    const res = await app.request("/api/bets");
    const data = await res.json();
    expect(data).toHaveLength(2);
  });

  test("filters by status", async () => {
    const deps = createMockDeps({
      betsRepo: {
        findAll: async () => [
          { id: "b1", status: "pending", competitorId: "c1", marketId: "m1", placedAt: new Date() },
          { id: "b2", status: "filled", competitorId: "c1", marketId: "m1", placedAt: new Date() },
        ],
      } as any,
      competitorsRepo: { findAll: async () => [{ id: "c1", name: "Claude" }] } as any,
      marketsRepo: { findAll: async () => [{ id: "m1", question: "Q" }] } as any,
    });

    const app = new Hono();
    app.route("/api", betsRoutes(deps));

    const res = await app.request("/api/bets?status=pending");
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("b1");
  });
});
