import { describe, expect, it, mock } from "bun:test";
import { createBetRetryService } from "../../../../src/domain/services/bet-retry";
import type { AuditLogRepo } from "../../../../src/database/repositories/audit-log";
import type { betsRepo as betsRepoFactory } from "../../../../src/database/repositories/bets";
import type { predictionsRepo as predictionsRepoFactory } from "../../../../src/database/repositories/predictions";
import type { BettingClient } from "../../../../src/apis/polymarket/betting-client";
import type { BettingClientFactory } from "../../../../src/apis/polymarket/betting-client-factory";

type BetsRepo = ReturnType<typeof betsRepoFactory>;
type PredictionsRepo = ReturnType<typeof predictionsRepoFactory>;

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

function makeFailedBet(overrides: Partial<BetRow> = {}): BetRow {
  return {
    id: "bet-1",
    orderId: null,
    marketId: "market-1",
    fixtureId: 1001,
    competitorId: "comp-a",
    tokenId: "token-1",
    side: "YES",
    amount: 5,
    price: 0.65,
    shares: 7.69,
    status: "failed",
    placedAt: new Date(),
    settledAt: null,
    profit: null,
    errorMessage: "Connection refused",
    errorCategory: "network_error",
    attempts: 1,
    lastAttemptAt: new Date(),
    ...overrides,
  };
}

function mockBetsRepo(retryableBets: BetRow[] = []): BetsRepo {
  return {
    create: mock(() => Promise.resolve()),
    createIfNoActiveBet: mock(() => Promise.resolve("created" as const)),
    hasActiveBetForMarket: mock(() => Promise.resolve(false)),
    findById: mock(() => Promise.resolve(undefined)),
    findByCompetitor: mock(() => Promise.resolve([])),
    findByStatus: mock(() => Promise.resolve([])),
    updateStatus: mock(() => Promise.resolve()),
    updateBetAfterSubmission: mock(() => Promise.resolve()),
    updateAmount: mock(() => Promise.resolve()),
    findRetryableBets: mock(() => Promise.resolve(retryableBets)),
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

function mockBettingClient(overrides?: Partial<BettingClient>): BettingClient {
  return {
    placeOrder: mock(() => Promise.resolve({ orderId: "retry-order-abc" })),
    cancelOrder: mock(() => Promise.resolve()),
    cancelAll: mock(() => Promise.resolve()),
    getOpenOrders: mock(() => Promise.resolve({ data: [] })),
    getTickSize: mock(() => Promise.resolve("0.01" as const)),
    getNegRisk: mock(() => Promise.resolve(false)),
    ...overrides,
  } as unknown as BettingClient;
}

function mockBettingClientFactory(client: BettingClient): BettingClientFactory {
  return {
    getClient: mock(() => client),
  } as unknown as BettingClientFactory;
}

function mockPredictionsRepo(): PredictionsRepo {
  return {
    create: mock(() => Promise.resolve()),
    findAll: mock(() => Promise.resolve([])),
    findRecent: mock(() => Promise.resolve([])),
    findByCompetitor: mock(() => Promise.resolve([])),
    findByMarket: mock(() => Promise.resolve([])),
    findByFixtureAndCompetitor: mock(() => Promise.resolve([])),
    addStakeAdjustment: mock(() => Promise.resolve()),
  } as unknown as PredictionsRepo;
}

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

describe("createBetRetryService", () => {
  it("retries failed bet with network_error and succeeds -> updated to pending", async () => {
    const bet = makeFailedBet({ errorCategory: "network_error", attempts: 1 });
    const repo = mockBetsRepo([bet]);
    const client = mockBettingClient();
    const factory = mockBettingClientFactory(client);

    const service = createBetRetryService({
      betsRepo: repo,
      bettingClientFactory: factory,
      auditLog: mockAuditLog(),
      predictionsRepo: mockPredictionsRepo(),
      walletConfigs: makeWalletConfigs(),
      maxRetryAttempts: 3,
      maxStakePerBet: 10,
      bankrollProvider: { getBankroll: mock(() => Promise.resolve(10)) },
      maxBumpPctOfBankroll: 0.2,
      proxyEnabled: false,
    });

    const result = await service.retryFailedBets();

    expect(result.retried).toBe(1);
    expect(result.succeeded).toBe(1);
    // Should set to submitting before API call, then update to pending
    expect(repo.updateStatus).toHaveBeenCalledWith("bet-1", "submitting");
    expect(repo.updateBetAfterSubmission).toHaveBeenCalledTimes(1);
    const [, update] = (repo.updateBetAfterSubmission as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      { status: string; orderId: string },
    ];
    expect(update.status).toBe("pending");
    expect(update.orderId).toBe("retry-order-abc");
  });

  it("retries failed bet with rate_limited and succeeds", async () => {
    const bet = makeFailedBet({ errorCategory: "rate_limited", attempts: 1 });
    const repo = mockBetsRepo([bet]);
    const client = mockBettingClient();
    const factory = mockBettingClientFactory(client);

    const service = createBetRetryService({
      betsRepo: repo,
      bettingClientFactory: factory,
      auditLog: mockAuditLog(),
      predictionsRepo: mockPredictionsRepo(),
      walletConfigs: makeWalletConfigs(),
      maxRetryAttempts: 3,
      maxStakePerBet: 10,
      bankrollProvider: { getBankroll: mock(() => Promise.resolve(10)) },
      maxBumpPctOfBankroll: 0.2,
      proxyEnabled: false,
    });

    const result = await service.retryFailedBets();

    expect(result.succeeded).toBe(1);
  });

  it("increments attempts when retry fails again", async () => {
    const bet = makeFailedBet({ attempts: 1 });
    const repo = mockBetsRepo([bet]);
    const client = mockBettingClient({
      placeOrder: mock(() => Promise.reject(new Error("Still failing"))),
    } as unknown as BettingClient);
    const factory = mockBettingClientFactory(client);

    const service = createBetRetryService({
      betsRepo: repo,
      bettingClientFactory: factory,
      auditLog: mockAuditLog(),
      predictionsRepo: mockPredictionsRepo(),
      walletConfigs: makeWalletConfigs(),
      maxRetryAttempts: 3,
      maxStakePerBet: 10,
      bankrollProvider: { getBankroll: mock(() => Promise.resolve(10)) },
      maxBumpPctOfBankroll: 0.2,
      proxyEnabled: false,
    });

    const result = await service.retryFailedBets();

    expect(result.retried).toBe(1);
    expect(result.failedAgain).toBe(1);
    const [, update] = (repo.updateBetAfterSubmission as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      { status: string; attempts: number },
    ];
    expect(update.status).toBe("failed");
    expect(update.attempts).toBe(2); // incremented from 1
  });

  it("sets status to submitting before retry API call (write-ahead)", async () => {
    const callOrder: string[] = [];
    const bet = makeFailedBet({ attempts: 1 });
    const repo = mockBetsRepo([bet]);
    (repo.updateStatus as ReturnType<typeof mock>).mockImplementation(() => {
      callOrder.push("updateStatus:submitting");
      return Promise.resolve();
    });

    const client = mockBettingClient({
      placeOrder: mock(() => {
        callOrder.push("placeOrder");
        return Promise.resolve({ orderId: "retry-order-abc" });
      }),
    } as unknown as BettingClient);
    const factory = mockBettingClientFactory(client);

    const service = createBetRetryService({
      betsRepo: repo,
      bettingClientFactory: factory,
      auditLog: mockAuditLog(),
      predictionsRepo: mockPredictionsRepo(),
      walletConfigs: makeWalletConfigs(),
      maxRetryAttempts: 3,
      maxStakePerBet: 10,
      bankrollProvider: { getBankroll: mock(() => Promise.resolve(10)) },
      maxBumpPctOfBankroll: 0.2,
      proxyEnabled: false,
    });

    await service.retryFailedBets();

    expect(callOrder).toEqual(["updateStatus:submitting", "placeOrder"]);
  });

  it("processes multiple failed bets independently", async () => {
    const bet1 = makeFailedBet({ id: "bet-1", attempts: 1 });
    const bet2 = makeFailedBet({
      id: "bet-2",
      orderId: null,
      marketId: "market-2",
      attempts: 1,
    });
    const repo = mockBetsRepo([bet1, bet2]);
    const client = mockBettingClient();
    const factory = mockBettingClientFactory(client);

    const service = createBetRetryService({
      betsRepo: repo,
      bettingClientFactory: factory,
      auditLog: mockAuditLog(),
      predictionsRepo: mockPredictionsRepo(),
      walletConfigs: makeWalletConfigs(),
      maxRetryAttempts: 3,
      maxStakePerBet: 10,
      bankrollProvider: { getBankroll: mock(() => Promise.resolve(10)) },
      maxBumpPctOfBankroll: 0.2,
      proxyEnabled: false,
    });

    const result = await service.retryFailedBets();

    expect(result.retried).toBe(2);
    expect(result.succeeded).toBe(2);
  });

  it("returns empty result when no retryable bets", async () => {
    const repo = mockBetsRepo([]);
    const client = mockBettingClient();
    const factory = mockBettingClientFactory(client);

    const service = createBetRetryService({
      betsRepo: repo,
      bettingClientFactory: factory,
      auditLog: mockAuditLog(),
      predictionsRepo: mockPredictionsRepo(),
      walletConfigs: makeWalletConfigs(),
      maxRetryAttempts: 3,
      maxStakePerBet: 10,
      bankrollProvider: { getBankroll: mock(() => Promise.resolve(10)) },
      maxBumpPctOfBankroll: 0.2,
      proxyEnabled: false,
    });

    const result = await service.retryFailedBets();

    expect(result.retried).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failedAgain).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("skips retry when active bet already exists for same market+competitor", async () => {
    const bet = makeFailedBet({ attempts: 1 });
    const repo = mockBetsRepo([bet]);
    (repo as unknown as Record<string, unknown>).hasActiveBetForMarket = mock(() =>
      Promise.resolve(true),
    );
    const client = mockBettingClient();
    const factory = mockBettingClientFactory(client);

    const service = createBetRetryService({
      betsRepo: repo,
      bettingClientFactory: factory,
      auditLog: mockAuditLog(),
      predictionsRepo: mockPredictionsRepo(),
      walletConfigs: makeWalletConfigs(),
      maxRetryAttempts: 3,
      maxStakePerBet: 10,
      bankrollProvider: { getBankroll: mock(() => Promise.resolve(10)) },
      maxBumpPctOfBankroll: 0.2,
      proxyEnabled: false,
    });

    const result = await service.retryFailedBets();

    expect(result.retried).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(repo.updateStatus).not.toHaveBeenCalled();
    expect(client.placeOrder).not.toHaveBeenCalled();
  });

  it("proceeds with retry when no active bet exists for market", async () => {
    const bet = makeFailedBet({ attempts: 1 });
    const repo = mockBetsRepo([bet]);
    (repo as unknown as Record<string, unknown>).hasActiveBetForMarket = mock(() =>
      Promise.resolve(false),
    );
    const client = mockBettingClient();
    const factory = mockBettingClientFactory(client);

    const service = createBetRetryService({
      betsRepo: repo,
      bettingClientFactory: factory,
      auditLog: mockAuditLog(),
      predictionsRepo: mockPredictionsRepo(),
      walletConfigs: makeWalletConfigs(),
      maxRetryAttempts: 3,
      maxStakePerBet: 10,
      bankrollProvider: { getBankroll: mock(() => Promise.resolve(10)) },
      maxBumpPctOfBankroll: 0.2,
      proxyEnabled: false,
    });

    const result = await service.retryFailedBets();

    expect(result.retried).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(repo.updateStatus).toHaveBeenCalledWith("bet-1", "submitting");
    expect(client.placeOrder).toHaveBeenCalled();
  });

  it("skips competitor without wallet config", async () => {
    const bet = makeFailedBet({ competitorId: "comp-no-wallet" });
    const repo = mockBetsRepo([bet]);
    const client = mockBettingClient();
    const factory = mockBettingClientFactory(client);

    const service = createBetRetryService({
      betsRepo: repo,
      bettingClientFactory: factory,
      auditLog: mockAuditLog(),
      predictionsRepo: mockPredictionsRepo(),
      walletConfigs: makeWalletConfigs(),
      maxRetryAttempts: 3,
      maxStakePerBet: 10,
      bankrollProvider: { getBankroll: mock(() => Promise.resolve(10)) },
      maxBumpPctOfBankroll: 0.2,
      proxyEnabled: false,
    });

    const result = await service.retryFailedBets();

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("No wallet config");
    expect(client.placeOrder).not.toHaveBeenCalled();
  });

  describe("audit logging", () => {
    it("records retry_started and retry_succeeded on success", async () => {
      const bet = makeFailedBet({ attempts: 1 });
      const repo = mockBetsRepo([bet]);
      const client = mockBettingClient();
      const factory = mockBettingClientFactory(client);
      const audit = mockAuditLog();

      const service = createBetRetryService({
        betsRepo: repo,
        bettingClientFactory: factory,
        auditLog: audit,
        predictionsRepo: mockPredictionsRepo(),
        walletConfigs: makeWalletConfigs(),
        maxRetryAttempts: 3,
        maxStakePerBet: 10,
        bankrollProvider: { getBankroll: mock(() => Promise.resolve(10)) },
        maxBumpPctOfBankroll: 0.2,
        proxyEnabled: false,
      });

      await service.retryFailedBets();

      expect(audit.safeRecord).toHaveBeenCalledTimes(2);
      const calls = (audit.safeRecord as ReturnType<typeof mock>).mock.calls as unknown[][];
      const first = calls[0]![0] as Record<string, unknown>;
      expect(first.event).toBe("retry_started");
      expect(first.statusBefore).toBe("failed");
      expect(first.statusAfter).toBe("submitting");

      const second = calls[1]![0] as Record<string, unknown>;
      expect(second.event).toBe("retry_succeeded");
      expect(second.statusBefore).toBe("submitting");
      expect(second.statusAfter).toBe("pending");
      expect(second.orderId).toBe("retry-order-abc");
    });

    it("records retry_started and retry_failed on failure", async () => {
      const bet = makeFailedBet({ attempts: 1 });
      const repo = mockBetsRepo([bet]);
      const client = mockBettingClient({
        placeOrder: mock(() => Promise.reject(new Error("Still failing"))),
      } as unknown as BettingClient);
      const factory = mockBettingClientFactory(client);
      const audit = mockAuditLog();

      const service = createBetRetryService({
        betsRepo: repo,
        bettingClientFactory: factory,
        auditLog: audit,
        predictionsRepo: mockPredictionsRepo(),
        walletConfigs: makeWalletConfigs(),
        maxRetryAttempts: 3,
        maxStakePerBet: 10,
        bankrollProvider: { getBankroll: mock(() => Promise.resolve(10)) },
        maxBumpPctOfBankroll: 0.2,
        proxyEnabled: false,
      });

      await service.retryFailedBets();

      expect(audit.safeRecord).toHaveBeenCalledTimes(2);
      const calls = (audit.safeRecord as ReturnType<typeof mock>).mock.calls as unknown[][];
      const first = calls[0]![0] as Record<string, unknown>;
      expect(first.event).toBe("retry_started");

      const second = calls[1]![0] as Record<string, unknown>;
      expect(second.event).toBe("retry_failed");
      expect(second.statusBefore).toBe("submitting");
      expect(second.statusAfter).toBe("failed");
      expect(second.error).toContain("Still failing");
    });
  });

  describe("auto-bump for order_too_small", () => {
    it("retries with bumped amount extracted from error message", async () => {
      const bet = makeFailedBet({
        amount: 0.31,
        errorCategory: "order_too_small",
        errorMessage: "invalid amount for a marketable BUY order ($0.31), min size: $1",
        attempts: 1,
      });
      const repo = mockBetsRepo([bet]);
      const client = mockBettingClient();
      const factory = mockBettingClientFactory(client);

      const service = createBetRetryService({
        betsRepo: repo,
        bettingClientFactory: factory,
        auditLog: mockAuditLog(),
        predictionsRepo: mockPredictionsRepo(),
        walletConfigs: makeWalletConfigs(),
        maxRetryAttempts: 3,
        maxStakePerBet: 10,
        bankrollProvider: { getBankroll: mock(() => Promise.resolve(10)) },
        maxBumpPctOfBankroll: 0.2,
        proxyEnabled: false,
      });

      const result = await service.retryFailedBets();

      expect(result.succeeded).toBe(1);
      const placeOrderCall = (client.placeOrder as ReturnType<typeof mock>).mock.calls[0]![0] as {
        amount: number;
      };
      expect(placeOrderCall.amount).toBe(1);
    });

    it("updates bet amount in DB before retrying", async () => {
      const bet = makeFailedBet({
        amount: 0.31,
        errorCategory: "order_too_small",
        errorMessage: "invalid amount for a marketable BUY order ($0.31), min size: $1",
        attempts: 1,
      });
      const repo = mockBetsRepo([bet]);
      const client = mockBettingClient();
      const factory = mockBettingClientFactory(client);

      const service = createBetRetryService({
        betsRepo: repo,
        bettingClientFactory: factory,
        auditLog: mockAuditLog(),
        predictionsRepo: mockPredictionsRepo(),
        walletConfigs: makeWalletConfigs(),
        maxRetryAttempts: 3,
        maxStakePerBet: 10,
        bankrollProvider: { getBankroll: mock(() => Promise.resolve(10)) },
        maxBumpPctOfBankroll: 0.2,
        proxyEnabled: false,
      });

      await service.retryFailedBets();

      expect(repo.updateAmount).toHaveBeenCalledWith("bet-1", 1);
    });

    it("records stake adjustment on the prediction", async () => {
      const bet = makeFailedBet({
        amount: 0.31,
        errorCategory: "order_too_small",
        errorMessage: "invalid amount for a marketable BUY order ($0.31), min size: $1",
        attempts: 1,
      });
      const repo = mockBetsRepo([bet]);
      const client = mockBettingClient();
      const factory = mockBettingClientFactory(client);
      const predsRepo = mockPredictionsRepo();

      const service = createBetRetryService({
        betsRepo: repo,
        bettingClientFactory: factory,
        auditLog: mockAuditLog(),
        predictionsRepo: predsRepo,
        walletConfigs: makeWalletConfigs(),
        maxRetryAttempts: 3,
        maxStakePerBet: 10,
        bankrollProvider: { getBankroll: mock(() => Promise.resolve(10)) },
        maxBumpPctOfBankroll: 0.2,
        proxyEnabled: false,
      });

      await service.retryFailedBets();

      expect(predsRepo.addStakeAdjustment).toHaveBeenCalledTimes(1);
      const [mktId, compId, adj] = (predsRepo.addStakeAdjustment as ReturnType<typeof mock>).mock
        .calls[0] as [string, string, { originalStake: number; adjustedStake: number; reason: string }];
      expect(mktId).toBe("market-1");
      expect(compId).toBe("comp-a");
      expect(adj.originalStake).toBe(0.31);
      expect(adj.adjustedStake).toBe(1);
      expect(adj.reason).toBe("min_bet_bump");
    });

    it("includes stakeAdjustment in audit metadata for bumped bets", async () => {
      const bet = makeFailedBet({
        amount: 0.31,
        errorCategory: "order_too_small",
        errorMessage: "invalid amount for a marketable BUY order ($0.31), min size: $1",
        attempts: 1,
      });
      const repo = mockBetsRepo([bet]);
      const client = mockBettingClient();
      const factory = mockBettingClientFactory(client);
      const audit = mockAuditLog();

      const service = createBetRetryService({
        betsRepo: repo,
        bettingClientFactory: factory,
        auditLog: audit,
        predictionsRepo: mockPredictionsRepo(),
        walletConfigs: makeWalletConfigs(),
        maxRetryAttempts: 3,
        maxStakePerBet: 10,
        bankrollProvider: { getBankroll: mock(() => Promise.resolve(10)) },
        maxBumpPctOfBankroll: 0.2,
        proxyEnabled: false,
      });

      await service.retryFailedBets();

      const calls = (audit.safeRecord as ReturnType<typeof mock>).mock.calls as unknown[][];
      const retryStarted = calls[0]![0] as Record<string, unknown>;
      expect(retryStarted.event).toBe("retry_started");
      const metadata = retryStarted.metadata as Record<string, unknown>;
      expect(metadata.stakeAdjustment).toBeDefined();
      const adj = metadata.stakeAdjustment as Record<string, unknown>;
      expect(adj.originalAmount).toBe(0.31);
      expect(adj.bumpedAmount).toBe(1);
    });

    it("falls back to original amount if min size cannot be extracted", async () => {
      const bet = makeFailedBet({
        amount: 0.31,
        errorCategory: "order_too_small",
        errorMessage: "order size is too small",
        attempts: 1,
      });
      const repo = mockBetsRepo([bet]);
      const client = mockBettingClient();
      const factory = mockBettingClientFactory(client);
      const predsRepo = mockPredictionsRepo();

      const service = createBetRetryService({
        betsRepo: repo,
        bettingClientFactory: factory,
        auditLog: mockAuditLog(),
        predictionsRepo: predsRepo,
        walletConfigs: makeWalletConfigs(),
        maxRetryAttempts: 3,
        maxStakePerBet: 10,
        bankrollProvider: { getBankroll: mock(() => Promise.resolve(10)) },
        maxBumpPctOfBankroll: 0.2,
        proxyEnabled: false,
      });

      await service.retryFailedBets();

      const placeOrderCall = (client.placeOrder as ReturnType<typeof mock>).mock.calls[0]![0] as {
        amount: number;
      };
      expect(placeOrderCall.amount).toBe(0.31);
      expect(predsRepo.addStakeAdjustment).not.toHaveBeenCalled();
    });

    it("does not bump if extracted min size is less than or equal to original amount", async () => {
      const bet = makeFailedBet({
        amount: 5,
        errorCategory: "order_too_small",
        errorMessage: "invalid amount, min size: $3",
        attempts: 1,
      });
      const repo = mockBetsRepo([bet]);
      const client = mockBettingClient();
      const factory = mockBettingClientFactory(client);
      const predsRepo = mockPredictionsRepo();

      const service = createBetRetryService({
        betsRepo: repo,
        bettingClientFactory: factory,
        auditLog: mockAuditLog(),
        predictionsRepo: predsRepo,
        walletConfigs: makeWalletConfigs(),
        maxRetryAttempts: 3,
        maxStakePerBet: 10,
        bankrollProvider: { getBankroll: mock(() => Promise.resolve(10)) },
        maxBumpPctOfBankroll: 0.2,
        proxyEnabled: false,
      });

      await service.retryFailedBets();

      const placeOrderCall = (client.placeOrder as ReturnType<typeof mock>).mock.calls[0]![0] as {
        amount: number;
      };
      expect(placeOrderCall.amount).toBe(5);
      expect(predsRepo.addStakeAdjustment).not.toHaveBeenCalled();
    });
  });

  describe("guard conditions", () => {
    it("skips retry when bumped min size exceeds maxStakePerBet", async () => {
      const bet = makeFailedBet({
        amount: 0.31,
        errorCategory: "order_too_small",
        errorMessage: "invalid amount for a marketable BUY order ($0.31), min size: $50",
        attempts: 1,
      });
      const repo = mockBetsRepo([bet]);
      const client = mockBettingClient();
      const factory = mockBettingClientFactory(client);
      const predsRepo = mockPredictionsRepo();

      const service = createBetRetryService({
        betsRepo: repo,
        bettingClientFactory: factory,
        auditLog: mockAuditLog(),
        predictionsRepo: predsRepo,
        walletConfigs: makeWalletConfigs(),
        maxRetryAttempts: 3,
        maxStakePerBet: 10,
        bankrollProvider: { getBankroll: mock(() => Promise.resolve(10)) },
        maxBumpPctOfBankroll: 0.2,
        proxyEnabled: false,
      });

      const result = await service.retryFailedBets();

      expect(result.retried).toBe(0);
      expect(client.placeOrder).not.toHaveBeenCalled();
      expect(repo.updateAmount).not.toHaveBeenCalled();
      expect(predsRepo.addStakeAdjustment).not.toHaveBeenCalled();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("min size $50 exceeds cap");
    });

    it("skips retry when bumped min size exceeds bankroll cap", async () => {
      const bet = makeFailedBet({
        amount: 0.31,
        errorCategory: "order_too_small",
        errorMessage: "order is invalid. Size (1.8) lower than the minimum: 5",
        attempts: 1,
      });
      const repo = mockBetsRepo([bet]);
      const client = mockBettingClient();
      const factory = mockBettingClientFactory(client);

      const service = createBetRetryService({
        betsRepo: repo,
        bettingClientFactory: factory,
        auditLog: mockAuditLog(),
        predictionsRepo: mockPredictionsRepo(),
        walletConfigs: makeWalletConfigs(),
        maxRetryAttempts: 3,
        maxStakePerBet: 100,
        bankrollProvider: { getBankroll: mock(() => Promise.resolve(10)) },
        maxBumpPctOfBankroll: 0.2,
        proxyEnabled: false,
      });

      const result = await service.retryFailedBets();

      // 20% of $10 bankroll = $2, min size $5 exceeds that
      expect(result.retried).toBe(0);
      expect(client.placeOrder).not.toHaveBeenCalled();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("min size $5 exceeds cap");
      expect(result.errors[0]).toContain("20% of bankroll");
    });
  });
});
