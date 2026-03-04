import { describe, expect, it, mock } from "bun:test";
import { createOrderConfirmationService } from "../../../../src/domain/services/order-confirmation";
import type { AuditLogRepo } from "../../../../src/database/repositories/audit-log";
import type { betsRepo as betsRepoFactory } from "../../../../src/database/repositories/bets";
import type { BettingClient } from "../../../../src/apis/polymarket/betting-client";
import type { BettingClientFactory } from "../../../../src/apis/polymarket/betting-client-factory";

type BetsRepo = ReturnType<typeof betsRepoFactory>;

function mockAuditLog(): AuditLogRepo {
  return {
    record: mock(() => Promise.resolve({} as any)),
    safeRecord: mock(() => Promise.resolve()),
    findByBetId: mock(() => Promise.resolve([])),
  };
}

type BetRow = {
  id: string;
  orderId: string | null;
  marketId: string;
  fixtureId: number;
  competitorId: string;
  tokenId: string;
  side: "YES" | "NO";
  amount: number;
  price: number;
  shares: number;
  status: string;
  placedAt: Date;
  settledAt: Date | null;
  profit: number | null;
  errorMessage: string | null;
  errorCategory: string | null;
  attempts: number;
  lastAttemptAt: Date | null;
};

function makeBetRow(overrides: Partial<BetRow> = {}): BetRow {
  return {
    id: "bet-1",
    orderId: "order-1",
    marketId: "market-1",
    fixtureId: 1001,
    competitorId: "comp-a",
    tokenId: "token-1",
    side: "YES",
    amount: 5,
    price: 0.65,
    shares: 7.69,
    status: "pending",
    placedAt: new Date(Date.now() - 60_000), // 1 min ago
    settledAt: null,
    profit: null,
    errorMessage: null,
    errorCategory: null,
    attempts: 0,
    lastAttemptAt: null,
    ...overrides,
  };
}

function mockBetsRepo(pendingBets: BetRow[] = [], submittingBets: BetRow[] = []): BetsRepo {
  return {
    create: mock(() => Promise.resolve()),
    findById: mock(() => Promise.resolve(undefined)),
    findByCompetitor: mock(() => Promise.resolve([])),
    findByStatus: mock((status: string) => {
      if (status === "submitting") return Promise.resolve(submittingBets);
      if (status === "pending") return Promise.resolve(pendingBets);
      return Promise.resolve([]);
    }),
    updateStatus: mock(() => Promise.resolve()),
    updateBetAfterSubmission: mock(() => Promise.resolve()),
    findRetryableBets: mock(() => Promise.resolve([])),
    findAll: mock(() => Promise.resolve([])),
    findRecent: mock(() => Promise.resolve([])),
    getPerformanceStats: mock(() =>
      Promise.resolve({
        competitorId: "",
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
    ),
  } as unknown as BetsRepo;
}

function mockBettingClient(openOrders: Array<{ id: string }> = []): BettingClient {
  return {
    placeOrder: mock(() => Promise.resolve({ orderId: "order-new" })),
    cancelOrder: mock(() => Promise.resolve()),
    cancelAll: mock(() => Promise.resolve()),
    getOpenOrders: mock(() => Promise.resolve({ data: openOrders })),
    getTickSize: mock(() => Promise.resolve("0.01" as const)),
    getNegRisk: mock(() => Promise.resolve(false)),
  } as unknown as BettingClient;
}

function mockBettingClientFactory(client: BettingClient): BettingClientFactory {
  return {
    getClient: mock(() => client),
  } as unknown as BettingClientFactory;
}

// Wallet configs keyed by competitor
function makeWalletConfigs() {
  return new Map([
    [
      "comp-a",
      {
        polyPrivateKey: "0xkey-a",
        polyApiKey: "api-a",
        polyApiSecret: "secret-a",
        polyApiPassphrase: "pass-a",
      },
    ],
  ]);
}

describe("createOrderConfirmationService", () => {
  it("updates pending bet to filled when order is no longer open", async () => {
    const bet = makeBetRow({ orderId: "order-1" });
    const repo = mockBetsRepo([bet]);
    // getOpenOrders returns empty -> order is no longer open -> filled
    const client = mockBettingClient([]);
    const factory = mockBettingClientFactory(client);

    const service = createOrderConfirmationService({
      betsRepo: repo,
      bettingClientFactory: factory,
      auditLog: mockAuditLog(),
      walletConfigs: makeWalletConfigs(),
      maxOrderAgeMs: 60 * 60 * 1000, // 1 hour
    });

    const result = await service.confirmOrders();

    expect(result.confirmed).toBe(1);
    expect(repo.updateStatus).toHaveBeenCalledWith("bet-1", "filled");
  });

  it("marks ghost order (null orderId) as failed instead of filled", async () => {
    const bet = makeBetRow({ orderId: null, attempts: 0 });
    const repo = mockBetsRepo([bet]);
    const client = mockBettingClient([]);
    const factory = mockBettingClientFactory(client);

    const service = createOrderConfirmationService({
      betsRepo: repo,
      bettingClientFactory: factory,
      auditLog: mockAuditLog(),
      walletConfigs: makeWalletConfigs(),
      maxOrderAgeMs: 60 * 60 * 1000,
    });

    const result = await service.confirmOrders();

    expect(result.failed).toBe(1);
    expect(repo.updateBetAfterSubmission).toHaveBeenCalledWith(
      "bet-1",
      expect.objectContaining({
        status: "failed",
        errorCategory: "unknown",
        attempts: 1,
      }),
    );
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it("marks ghost order with '[object Object]' orderId as failed", async () => {
    // This is what happened before the fix: CLOB error response got stringified
    const bet = makeBetRow({ orderId: "[object Object]", attempts: 0 });
    const repo = mockBetsRepo([bet]);
    const client = mockBettingClient([]);
    const factory = mockBettingClientFactory(client);

    const service = createOrderConfirmationService({
      betsRepo: repo,
      bettingClientFactory: factory,
      auditLog: mockAuditLog(),
      walletConfigs: makeWalletConfigs(),
      maxOrderAgeMs: 60 * 60 * 1000,
    });

    const result = await service.confirmOrders();

    expect(result.failed).toBe(1);
    expect(repo.updateBetAfterSubmission).toHaveBeenCalledWith(
      "bet-1",
      expect.objectContaining({
        status: "failed",
        errorCategory: "unknown",
      }),
    );
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it("leaves pending bet as pending when order is still open and not stale", async () => {
    const bet = makeBetRow({ orderId: "order-1" });
    const repo = mockBetsRepo([bet]);
    // Order is still open
    const client = mockBettingClient([{ id: "order-1" }]);
    const factory = mockBettingClientFactory(client);

    const service = createOrderConfirmationService({
      betsRepo: repo,
      bettingClientFactory: factory,
      auditLog: mockAuditLog(),
      walletConfigs: makeWalletConfigs(),
      maxOrderAgeMs: 60 * 60 * 1000,
    });

    const result = await service.confirmOrders();

    expect(result.confirmed).toBe(0);
    expect(result.stillPending).toBe(1);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it("cancels stale pending bet past maxOrderAge", async () => {
    const staleTime = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    const bet = makeBetRow({ orderId: "order-1", placedAt: staleTime });
    const repo = mockBetsRepo([bet]);
    // Order still open but stale
    const client = mockBettingClient([{ id: "order-1" }]);
    const factory = mockBettingClientFactory(client);

    const service = createOrderConfirmationService({
      betsRepo: repo,
      bettingClientFactory: factory,
      auditLog: mockAuditLog(),
      walletConfigs: makeWalletConfigs(),
      maxOrderAgeMs: 60 * 60 * 1000, // 1 hour
    });

    const result = await service.confirmOrders();

    expect(result.cancelled).toBe(1);
    expect(client.cancelOrder).toHaveBeenCalledWith("order-1");
    expect(repo.updateStatus).toHaveBeenCalledWith("bet-1", "cancelled");
  });

  it("returns empty result when no pending bets", async () => {
    const repo = mockBetsRepo([]);
    const client = mockBettingClient();
    const factory = mockBettingClientFactory(client);

    const service = createOrderConfirmationService({
      betsRepo: repo,
      bettingClientFactory: factory,
      auditLog: mockAuditLog(),
      walletConfigs: makeWalletConfigs(),
      maxOrderAgeMs: 60 * 60 * 1000,
    });

    const result = await service.confirmOrders();

    expect(result.confirmed).toBe(0);
    expect(result.cancelled).toBe(0);
    expect(result.stillPending).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("handles API error for one competitor and continues processing others", async () => {
    const bet1 = makeBetRow({ id: "bet-1", orderId: "order-1", competitorId: "comp-a" });
    const bet2 = makeBetRow({ id: "bet-2", orderId: "order-2", competitorId: "comp-b" });
    const repo = mockBetsRepo([bet1, bet2]);

    let callCount = 0;
    const client = mockBettingClient();
    (client.getOpenOrders as ReturnType<typeof mock>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error("API down"));
      return Promise.resolve({ data: [] });
    });
    const factory = mockBettingClientFactory(client);

    const walletConfigs = makeWalletConfigs();
    walletConfigs.set("comp-b", {
      polyPrivateKey: "0xkey-b",
      polyApiKey: "api-b",
      polyApiSecret: "secret-b",
      polyApiPassphrase: "pass-b",
    });

    const service = createOrderConfirmationService({
      betsRepo: repo,
      bettingClientFactory: factory,
      auditLog: mockAuditLog(),
      walletConfigs,
      maxOrderAgeMs: 60 * 60 * 1000,
    });

    const result = await service.confirmOrders();

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("API down");
    // Second competitor's bet should still be processed
    expect(result.confirmed).toBe(1);
  });

  it("groups bets by competitor and uses correct wallet", async () => {
    const bet1 = makeBetRow({ id: "bet-1", orderId: "order-1", competitorId: "comp-a" });
    const repo = mockBetsRepo([bet1]);
    const client = mockBettingClient([]);
    const factory = mockBettingClientFactory(client);
    const walletConfigs = makeWalletConfigs();

    const service = createOrderConfirmationService({
      betsRepo: repo,
      bettingClientFactory: factory,
      auditLog: mockAuditLog(),
      walletConfigs,
      maxOrderAgeMs: 60 * 60 * 1000,
    });

    await service.confirmOrders();

    expect(factory.getClient).toHaveBeenCalledWith("comp-a", walletConfigs.get("comp-a"));
  });

  it("skips competitor without wallet config", async () => {
    const bet = makeBetRow({ id: "bet-1", orderId: "order-1", competitorId: "comp-no-wallet" });
    const repo = mockBetsRepo([bet]);
    const client = mockBettingClient();
    const factory = mockBettingClientFactory(client);

    const service = createOrderConfirmationService({
      betsRepo: repo,
      bettingClientFactory: factory,
      auditLog: mockAuditLog(),
      walletConfigs: makeWalletConfigs(), // only has comp-a
      maxOrderAgeMs: 60 * 60 * 1000,
    });

    const result = await service.confirmOrders();

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("No wallet config");
    expect(factory.getClient).not.toHaveBeenCalled();
  });

  describe("audit logging", () => {
    it("records order_confirmed when order is filled", async () => {
      const bet = makeBetRow({ orderId: "order-1" });
      const repo = mockBetsRepo([bet]);
      const client = mockBettingClient([]);
      const factory = mockBettingClientFactory(client);
      const audit = mockAuditLog();

      const service = createOrderConfirmationService({
        betsRepo: repo,
        bettingClientFactory: factory,
        auditLog: audit,
        walletConfigs: makeWalletConfigs(),
        maxOrderAgeMs: 60 * 60 * 1000,
      });

      await service.confirmOrders();

      expect(audit.safeRecord).toHaveBeenCalledTimes(1);
      const entry = (audit.safeRecord as ReturnType<typeof mock>).mock.calls[0]![0] as Record<string, unknown>;
      expect(entry.event).toBe("order_confirmed");
      expect(entry.statusBefore).toBe("pending");
      expect(entry.statusAfter).toBe("filled");
      expect(entry.orderId).toBe("order-1");
    });

    it("records order_cancelled for stale order", async () => {
      const staleTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const bet = makeBetRow({ orderId: "order-1", placedAt: staleTime });
      const repo = mockBetsRepo([bet]);
      const client = mockBettingClient([{ id: "order-1" }]);
      const factory = mockBettingClientFactory(client);
      const audit = mockAuditLog();

      const service = createOrderConfirmationService({
        betsRepo: repo,
        bettingClientFactory: factory,
        auditLog: audit,
        walletConfigs: makeWalletConfigs(),
        maxOrderAgeMs: 60 * 60 * 1000,
      });

      await service.confirmOrders();

      expect(audit.safeRecord).toHaveBeenCalledTimes(1);
      const entry = (audit.safeRecord as ReturnType<typeof mock>).mock.calls[0]![0] as Record<string, unknown>;
      expect(entry.event).toBe("order_cancelled");
      expect(entry.statusBefore).toBe("pending");
      expect(entry.statusAfter).toBe("cancelled");
    });

    it("records stuck_bet_recovered for stuck submitting bet", async () => {
      const staleTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const stuckBet = makeBetRow({ id: "stuck-1", status: "submitting", placedAt: staleTime });
      const repo = mockBetsRepo([], [stuckBet]);
      const client = mockBettingClient([]);
      const factory = mockBettingClientFactory(client);
      const audit = mockAuditLog();

      const service = createOrderConfirmationService({
        betsRepo: repo,
        bettingClientFactory: factory,
        auditLog: audit,
        walletConfigs: makeWalletConfigs(),
        maxOrderAgeMs: 60 * 60 * 1000,
      });

      await service.confirmOrders();

      expect(audit.safeRecord).toHaveBeenCalledTimes(1);
      const entry = (audit.safeRecord as ReturnType<typeof mock>).mock.calls[0]![0] as Record<string, unknown>;
      expect(entry.event).toBe("stuck_bet_recovered");
      expect(entry.statusBefore).toBe("submitting");
      expect(entry.statusAfter).toBe("failed");
    });

    it("records ghost_order_detected for invalid orderId", async () => {
      const bet = makeBetRow({ orderId: null, attempts: 0 });
      const repo = mockBetsRepo([bet]);
      const client = mockBettingClient([]);
      const factory = mockBettingClientFactory(client);
      const audit = mockAuditLog();

      const service = createOrderConfirmationService({
        betsRepo: repo,
        bettingClientFactory: factory,
        auditLog: audit,
        walletConfigs: makeWalletConfigs(),
        maxOrderAgeMs: 60 * 60 * 1000,
      });

      await service.confirmOrders();

      expect(audit.safeRecord).toHaveBeenCalledTimes(1);
      const entry = (audit.safeRecord as ReturnType<typeof mock>).mock.calls[0]![0] as Record<string, unknown>;
      expect(entry.event).toBe("ghost_order_detected");
      expect(entry.statusBefore).toBe("pending");
      expect(entry.statusAfter).toBe("failed");
    });
  });
});
