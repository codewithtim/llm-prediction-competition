import { describe, expect, mock, test } from "bun:test";
import type { RedemptionResult } from "../../../src/apis/polymarket/redemption-client.ts";
import {
  createRedemptionPipeline,
  type RedemptionPipelineDeps,
} from "../../../src/orchestrator/redemption-pipeline.ts";

function makeBet(overrides: Record<string, unknown> = {}) {
  return {
    id: "bet-1",
    orderId: "order-1",
    marketId: "market-1",
    fixtureId: 1001,
    competitorId: "claude-1",
    tokenId: "tok-yes",
    side: "YES" as const,
    amount: 10,
    price: 0.65,
    shares: 15.38,
    status: "settled_won" as const,
    placedAt: new Date(),
    settledAt: new Date(),
    profit: 5.38,
    errorMessage: null,
    errorCategory: null,
    attempts: 0,
    lastAttemptAt: null,
    redeemedAt: null,
    redemptionTxHash: null,
    ...overrides,
  };
}

function makeMarket(overrides: Record<string, unknown> = {}) {
  return {
    id: "market-1",
    conditionId: "0xcond1",
    slug: "test",
    question: "Test?",
    outcomes: ["Yes", "No"] as [string, string],
    outcomePrices: ["1", "0"] as [string, string],
    tokenIds: ["tok-yes", "tok-no"] as [string, string],
    active: false,
    closed: true,
    acceptingOrders: false,
    liquidity: 1000,
    volume: 5000,
    gameId: null,
    sportsMarketType: null,
    line: null,
    polymarketUrl: null,
    fixtureId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockRedemptionClientFactory(redeemFn?: () => Promise<RedemptionResult>) {
  const defaultRedeem = (): Promise<RedemptionResult> =>
    Promise.resolve({ txHash: "0xtx123", conditionId: "0xcond1" });
  return () => ({
    redeemPositions: mock(redeemFn ?? defaultRedeem),
  });
}

function buildDeps(overrides: Partial<RedemptionPipelineDeps> = {}): RedemptionPipelineDeps {
  return {
    betsRepo: {
      findUnredeemedWins: mock(() => Promise.resolve([])),
      markRedeemed: mock(() => Promise.resolve()),
    } as unknown as RedemptionPipelineDeps["betsRepo"],
    marketsRepo: {
      findByIds: mock(() => Promise.resolve([])),
    } as unknown as RedemptionPipelineDeps["marketsRepo"],
    bettingClientFactory: {
      getClient: mock(() => ({
        getNegRisk: mock(() => Promise.resolve(true)),
      })),
    } as unknown as RedemptionPipelineDeps["bettingClientFactory"],
    auditLog: {
      safeRecord: mock(() => Promise.resolve()),
    } as unknown as RedemptionPipelineDeps["auditLog"],
    walletConfigs: new Map(),
    createRedemptionClient: mockRedemptionClientFactory(),
    ...overrides,
  };
}

const walletConfigs = new Map([
  [
    "claude-1",
    {
      polyPrivateKey: "0xpk",
      polyApiKey: "key",
      polyApiSecret: "secret",
      polyApiPassphrase: "pass",
    },
  ],
]);

describe("redemption pipeline", () => {
  test("no-op when no unredeemed bets exist", async () => {
    const deps = buildDeps();
    const pipeline = createRedemptionPipeline(deps);
    const result = await pipeline.run();
    expect(result.redeemed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  test("skips competitors without wallet config", async () => {
    const deps = buildDeps({
      betsRepo: {
        findUnredeemedWins: mock(() => Promise.resolve([makeBet()])),
        markRedeemed: mock(() => Promise.resolve()),
      } as unknown as RedemptionPipelineDeps["betsRepo"],
      marketsRepo: {
        findByIds: mock(() => Promise.resolve([makeMarket()])),
      } as unknown as RedemptionPipelineDeps["marketsRepo"],
      walletConfigs: new Map(),
    });

    const pipeline = createRedemptionPipeline(deps);
    const result = await pipeline.run();
    expect(result.skipped).toBe(1);
    expect(result.redeemed).toBe(0);
  });

  test("redeems winning bets and records audit log", async () => {
    const mockMarkRedeemed = mock(() => Promise.resolve());
    const mockSafeRecord = mock(() => Promise.resolve());

    const deps = buildDeps({
      betsRepo: {
        findUnredeemedWins: mock(() => Promise.resolve([makeBet()])),
        markRedeemed: mockMarkRedeemed,
      } as unknown as RedemptionPipelineDeps["betsRepo"],
      marketsRepo: {
        findByIds: mock(() => Promise.resolve([makeMarket()])),
      } as unknown as RedemptionPipelineDeps["marketsRepo"],
      auditLog: {
        safeRecord: mockSafeRecord,
      } as unknown as RedemptionPipelineDeps["auditLog"],
      walletConfigs,
      createRedemptionClient: mockRedemptionClientFactory(),
    });

    const pipeline = createRedemptionPipeline(deps);
    const result = await pipeline.run();

    expect(result.redeemed).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(mockMarkRedeemed).toHaveBeenCalledTimes(1);
    expect(mockSafeRecord).toHaveBeenCalledTimes(1);
  });

  test("handles redemption failure gracefully", async () => {
    const deps = buildDeps({
      betsRepo: {
        findUnredeemedWins: mock(() => Promise.resolve([makeBet()])),
        markRedeemed: mock(() => Promise.resolve()),
      } as unknown as RedemptionPipelineDeps["betsRepo"],
      marketsRepo: {
        findByIds: mock(() => Promise.resolve([makeMarket()])),
      } as unknown as RedemptionPipelineDeps["marketsRepo"],
      walletConfigs,
      createRedemptionClient: mockRedemptionClientFactory(() =>
        Promise.reject(new Error("RPC timeout")),
      ),
    });

    const pipeline = createRedemptionPipeline(deps);
    const result = await pipeline.run();

    expect(result.redeemed).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("RPC timeout");
  });

  test("fetches markets in bulk (no N+1)", async () => {
    const mockFindByIds = mock(() => Promise.resolve([makeMarket()]));

    const deps = buildDeps({
      betsRepo: {
        findUnredeemedWins: mock(() =>
          Promise.resolve([makeBet({ id: "bet-1" }), makeBet({ id: "bet-2" })]),
        ),
        markRedeemed: mock(() => Promise.resolve()),
      } as unknown as RedemptionPipelineDeps["betsRepo"],
      marketsRepo: {
        findByIds: mockFindByIds,
      } as unknown as RedemptionPipelineDeps["marketsRepo"],
      walletConfigs: new Map(),
    });

    const pipeline = createRedemptionPipeline(deps);
    await pipeline.run();

    expect(mockFindByIds).toHaveBeenCalledTimes(1);
    expect(mockFindByIds).toHaveBeenCalledWith(["market-1"]);
  });

  test("groups bets by conditionId for single redemption call", async () => {
    const mockMarkRedeemed = mock(() => Promise.resolve());
    const mockRedeem = mock(() =>
      Promise.resolve({ txHash: "0xtx456", conditionId: "0xcond1" }),
    );

    const deps = buildDeps({
      betsRepo: {
        findUnredeemedWins: mock(() =>
          Promise.resolve([
            makeBet({ id: "bet-1", shares: 10 }),
            makeBet({ id: "bet-2", shares: 5 }),
          ]),
        ),
        markRedeemed: mockMarkRedeemed,
      } as unknown as RedemptionPipelineDeps["betsRepo"],
      marketsRepo: {
        findByIds: mock(() => Promise.resolve([makeMarket()])),
      } as unknown as RedemptionPipelineDeps["marketsRepo"],
      auditLog: {
        safeRecord: mock(() => Promise.resolve()),
      } as unknown as RedemptionPipelineDeps["auditLog"],
      walletConfigs,
      createRedemptionClient: () => ({
        redeemPositions: mockRedeem,
      }),
    });

    const pipeline = createRedemptionPipeline(deps);
    const result = await pipeline.run();

    expect(result.redeemed).toBe(2);
    expect(mockMarkRedeemed).toHaveBeenCalledTimes(2);
    // Only one redemption call for both bets (same conditionId)
    expect(mockRedeem).toHaveBeenCalledTimes(1);
  });
});
