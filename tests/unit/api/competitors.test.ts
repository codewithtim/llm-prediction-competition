import { afterEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import { competitorsRoutes } from "../../../src/api/routes/competitors";
import { createMockDeps } from "./helpers";

const originalFetch = globalThis.fetch;

function mockBalanceFetch(balanceHex: string) {
  globalThis.fetch = mock(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: balanceHex }),
    } as Response),
  ) as any;
}

function mockBalanceFetchFailure() {
  globalThis.fetch = mock(() => Promise.reject(new Error("rpc down"))) as any;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

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
  test("returns all competitors with stats and onChainBalance", async () => {
    // 10 USDC = 0x989680
    mockBalanceFetch("0x0000000000000000000000000000000000000000000000000000000000989680");

    const deps = createMockDeps({
      competitorsRepo: {
        findAll: async () => [sampleCompetitor],
      } as any,
      walletsRepo: {
        listAll: async () => [{ competitorId: "c1", walletAddress: "0xabc" }],
      } as any,
      betsRepo: {
        getAllPerformanceStats: async () =>
          new Map([
            [
              "c1",
              {
                competitorId: "c1",
                totalBets: 5,
                wins: 3,
                losses: 1,
                pending: 1,
                failed: 0,
                lockedAmount: 0,
                totalStaked: 50,
                totalReturned: 65,
                profitLoss: 15,
                accuracy: 0.75,
                roi: 0.3,
              },
            ],
          ]),
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
    expect(data[0].onChainBalance).toBe(10);
    expect(data[0].stats.wins).toBe(3);
  });

  test("returns null onChainBalance when competitor has no wallet", async () => {
    const deps = createMockDeps({
      competitorsRepo: { findAll: async () => [sampleCompetitor] } as any,
      walletsRepo: { listAll: async () => [] } as any,
      betsRepo: { getAllPerformanceStats: async () => new Map() } as any,
    });

    const app = new Hono();
    app.route("/api", competitorsRoutes(deps));

    const res = await app.request("/api/competitors");
    const data = await res.json();
    expect(data[0].onChainBalance).toBeNull();
  });

  test("returns null onChainBalance when RPC fails", async () => {
    mockBalanceFetchFailure();

    const deps = createMockDeps({
      competitorsRepo: { findAll: async () => [sampleCompetitor] } as any,
      walletsRepo: {
        listAll: async () => [{ competitorId: "c1", walletAddress: "0xabc" }],
      } as any,
      betsRepo: { getAllPerformanceStats: async () => new Map() } as any,
    });

    const app = new Hono();
    app.route("/api", competitorsRoutes(deps));

    const res = await app.request("/api/competitors");
    const data = await res.json();
    expect(data[0].onChainBalance).toBeNull();
  });

  test("filters by status", async () => {
    const deps = createMockDeps({
      competitorsRepo: {
        findByStatus: async (status: string) => (status === "active" ? [sampleCompetitor] : []),
      } as any,
      walletsRepo: { listAll: async () => [] } as any,
      betsRepo: {
        getAllPerformanceStats: async () => new Map(),
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
  test("returns competitor detail with onChainBalance and computedBankroll", async () => {
    // 8.5 USDC = 8_500_000 = 0x81B320
    mockBalanceFetch("0x000000000000000000000000000000000000000000000000000000000081B320");

    const deps = createMockDeps({
      competitorsRepo: {
        findById: async () => sampleCompetitor,
      } as any,
      walletsRepo: {
        listAll: async () => [{ competitorId: "c1", walletAddress: "0xWallet" }],
      } as any,
      betsRepo: {
        getPerformanceStats: async () => ({
          competitorId: "c1",
          totalBets: 0,
          wins: 0,
          losses: 0,
          pending: 0,
          failed: 0,
          lockedAmount: 0,
          totalStaked: 0,
          totalReturned: 0,
          profitLoss: 0,
          accuracy: 0,
          roi: 0,
        }),
        findByCompetitor: async () => [],
      } as any,
      competitorVersionsRepo: { findByCompetitor: async () => [] } as any,
      predictionsRepo: { findByCompetitor: async () => [] } as any,
      bankrollProvider: { getBankroll: async () => 7.5 } as any,
    });

    const app = new Hono();
    app.route("/api", competitorsRoutes(deps));

    const res = await app.request("/api/competitors/c1");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.name).toBe("Claude");
    expect(data.onChainBalance).toBe(8.5);
    expect(data.computedBankroll).toBe(7.5);
    expect(data.versions).toEqual([]);
  });

  test("returns null onChainBalance when no wallet", async () => {
    const deps = createMockDeps({
      competitorsRepo: {
        findById: async () => sampleCompetitor,
      } as any,
      walletsRepo: { listAll: async () => [] } as any,
      betsRepo: {
        getPerformanceStats: async () => ({
          competitorId: "c1",
          totalBets: 0,
          wins: 0,
          losses: 0,
          pending: 0,
          failed: 0,
          lockedAmount: 0,
          totalStaked: 0,
          totalReturned: 0,
          profitLoss: 0,
          accuracy: 0,
          roi: 0,
        }),
        findByCompetitor: async () => [],
      } as any,
      competitorVersionsRepo: { findByCompetitor: async () => [] } as any,
      predictionsRepo: { findByCompetitor: async () => [] } as any,
    });

    const app = new Hono();
    app.route("/api", competitorsRoutes(deps));

    const res = await app.request("/api/competitors/c1");
    const data = await res.json();
    expect(data.onChainBalance).toBeNull();
    expect(data.computedBankroll).toBe(10); // default from mock
  });

  test("returns confidence in recentBets", async () => {
    const deps = createMockDeps({
      competitorsRepo: {
        findById: async () => sampleCompetitor,
        findAll: async () => [sampleCompetitor],
      } as any,
      walletsRepo: { listAll: async () => [] } as any,
      betsRepo: {
        getPerformanceStats: async () => ({
          competitorId: "c1", totalBets: 1, wins: 0, losses: 0, pending: 1, failed: 0, lockedAmount: 10, totalStaked: 0, totalReturned: 0, profitLoss: 0, accuracy: 0, roi: 0,
        }),
        findByCompetitor: async () => [
          { id: "b1", competitorId: "c1", marketId: "m1", fixtureId: 1, side: "YES", amount: 10, price: 0.6, shares: 16, status: "pending", placedAt: new Date(), settledAt: null, profit: null },
        ],
      } as any,
      competitorVersionsRepo: { findByCompetitor: async () => [] } as any,
      predictionsRepo: {
        findByCompetitor: async () => [
          { competitorId: "c1", marketId: "m1", side: "YES", confidence: 0.91, fixtureId: 1, stake: 10, reasoning: { summary: "", sections: [] }, createdAt: new Date() },
        ],
      } as any,
      marketsRepo: {
        findByIds: async () => [{ id: "m1", question: "Will Arsenal win?", polymarketUrl: null }],
      } as any,
    });

    const app = new Hono();
    app.route("/api", competitorsRoutes(deps));

    const res = await app.request("/api/competitors/c1");
    const data = await res.json();
    expect(data.recentBets).toHaveLength(1);
    expect(data.recentBets[0].confidence).toBe(0.91);
  });

  test("returns null confidence when no prediction matches", async () => {
    const deps = createMockDeps({
      competitorsRepo: {
        findById: async () => sampleCompetitor,
        findAll: async () => [sampleCompetitor],
      } as any,
      walletsRepo: { listAll: async () => [] } as any,
      betsRepo: {
        getPerformanceStats: async () => ({
          competitorId: "c1", totalBets: 1, wins: 0, losses: 0, pending: 1, failed: 0, lockedAmount: 10, totalStaked: 0, totalReturned: 0, profitLoss: 0, accuracy: 0, roi: 0,
        }),
        findByCompetitor: async () => [
          { id: "b1", competitorId: "c1", marketId: "m1", fixtureId: 1, side: "YES", amount: 10, price: 0.6, shares: 16, status: "pending", placedAt: new Date(), settledAt: null, profit: null },
        ],
      } as any,
      competitorVersionsRepo: { findByCompetitor: async () => [] } as any,
      predictionsRepo: { findByCompetitor: async () => [] } as any,
      marketsRepo: {
        findByIds: async () => [{ id: "m1", question: "Will Arsenal win?", polymarketUrl: null }],
      } as any,
    });

    const app = new Hono();
    app.route("/api", competitorsRoutes(deps));

    const res = await app.request("/api/competitors/c1");
    const data = await res.json();
    expect(data.recentBets).toHaveLength(1);
    expect(data.recentBets[0].confidence).toBeNull();
  });

  test("returns 404 for missing competitor", async () => {
    const deps = createMockDeps();

    const app = new Hono();
    app.route("/api", competitorsRoutes(deps));

    const res = await app.request("/api/competitors/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/competitors/:id/bankroll-history", () => {
  test("returns bankroll history from settled bets", async () => {
    const deps = createMockDeps({
      competitorsRepo: {
        findById: async () => sampleCompetitor,
      } as any,
      betsRepo: {
        findByCompetitor: async () => [
          { id: "b1", competitorId: "c1", status: "settled_won", settledAt: new Date("2026-01-10"), profit: 5, amount: 5 },
          { id: "b2", competitorId: "c1", status: "settled_lost", settledAt: new Date("2026-01-15"), profit: -3, amount: 3 },
          { id: "b3", competitorId: "c1", status: "pending", settledAt: null, profit: null, amount: 2 },
        ],
      } as any,
      initialBankroll: 10,
    });

    const app = new Hono();
    app.route("/api", competitorsRoutes(deps));

    const res = await app.request("/api/competitors/c1/bankroll-history");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveLength(2); // only settled bets
    expect(data[0].bankroll).toBe(15); // 10 + 5
    expect(data[0].date).toContain("2026-01-10");
    expect(data[1].bankroll).toBe(12); // 15 - 3
    expect(data[1].date).toContain("2026-01-15");
  });

  test("returns empty array when no settled bets", async () => {
    const deps = createMockDeps({
      competitorsRepo: {
        findById: async () => sampleCompetitor,
      } as any,
      betsRepo: {
        findByCompetitor: async () => [
          { id: "b1", competitorId: "c1", status: "pending", settledAt: null, profit: null, amount: 5 },
        ],
      } as any,
    });

    const app = new Hono();
    app.route("/api", competitorsRoutes(deps));

    const res = await app.request("/api/competitors/c1/bankroll-history");
    const data = await res.json();
    expect(data).toEqual([]);
  });

  test("sorts by settledAt ascending", async () => {
    const deps = createMockDeps({
      competitorsRepo: {
        findById: async () => sampleCompetitor,
      } as any,
      betsRepo: {
        findByCompetitor: async () => [
          // returned out of order
          { id: "b2", competitorId: "c1", status: "settled_won", settledAt: new Date("2026-02-01"), profit: 2, amount: 2 },
          { id: "b1", competitorId: "c1", status: "settled_lost", settledAt: new Date("2026-01-01"), profit: -1, amount: 1 },
        ],
      } as any,
      initialBankroll: 10,
    });

    const app = new Hono();
    app.route("/api", competitorsRoutes(deps));

    const res = await app.request("/api/competitors/c1/bankroll-history");
    const data = await res.json();
    expect(data).toHaveLength(2);
    expect(data[0].date).toContain("2026-01-01"); // earlier first
    expect(data[0].bankroll).toBe(9); // 10 - 1
    expect(data[1].date).toContain("2026-02-01");
    expect(data[1].bankroll).toBe(11); // 9 + 2
  });

  test("returns 404 for missing competitor", async () => {
    const deps = createMockDeps();

    const app = new Hono();
    app.route("/api", competitorsRoutes(deps));

    const res = await app.request("/api/competitors/nonexistent/bankroll-history");
    expect(res.status).toBe(404);
  });

  test("rounds bankroll to 2 decimal places", async () => {
    const deps = createMockDeps({
      competitorsRepo: {
        findById: async () => sampleCompetitor,
      } as any,
      betsRepo: {
        findByCompetitor: async () => [
          { id: "b1", competitorId: "c1", status: "settled_won", settledAt: new Date("2026-01-10"), profit: 1.333333, amount: 1 },
        ],
      } as any,
      initialBankroll: 10,
    });

    const app = new Hono();
    app.route("/api", competitorsRoutes(deps));

    const res = await app.request("/api/competitors/c1/bankroll-history");
    const data = await res.json();
    expect(data[0].bankroll).toBe(11.33);
  });
});
