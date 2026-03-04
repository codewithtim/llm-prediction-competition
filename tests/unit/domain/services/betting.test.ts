import { describe, expect, it, mock } from "bun:test";
import type { PredictionOutput } from "../../../../src/domain/contracts/prediction";
import type { Market } from "../../../../src/domain/models/market";
import type { BetErrorCategory } from "../../../../src/domain/models/prediction";
import {
  type BettingConfig,
  clampStake,
  createBettingService,
  type PlaceBetInput,
  resolveTokenId,
} from "../../../../src/domain/services/betting";
import type { WalletConfig } from "../../../../src/domain/types/competitor";
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

function makeMarket(overrides?: Partial<Market>): Market {
  return {
    id: "market-1",
    conditionId: "0xabc123",
    slug: "will-arsenal-win",
    question: "Will Arsenal win?",
    outcomes: ["Yes", "No"] as [string, string],
    outcomePrices: ["0.65", "0.35"] as [string, string],
    tokenIds: ["token_yes_123", "token_no_456"] as [string, string],
    active: true,
    closed: false,
    acceptingOrders: true,
    liquidity: 10000,
    volume: 50000,
    gameId: "12345",
    sportsMarketType: "moneyline",
    line: null,
    polymarketUrl: null,
    ...overrides,
  };
}

function makePrediction(overrides?: Partial<PredictionOutput>): PredictionOutput {
  return {
    marketId: "market-1",
    side: "YES",
    confidence: 0.75,
    stake: 0.05,
    reasoning: {
      summary: "Strong home form",
      sections: [{ label: "Analysis", content: "Strong home form" }],
    },
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<BettingConfig>): BettingConfig {
  return {
    maxStakePerBet: 10,
    maxBetPctOfBankroll: 0.1,
    maxTotalExposure: 100,
    initialBankroll: 100,
    minBetAmount: 0.01,
    dryRun: false,
    ...overrides,
  };
}

const TEST_WALLET_CONFIG: WalletConfig = {
  polyPrivateKey: "0xtest-private-key",
  polyApiKey: "test-api-key",
  polyApiSecret: "test-api-secret",
  polyApiPassphrase: "test-api-passphrase",
};

function mockBettingClient(overrides?: Partial<BettingClient>): BettingClient {
  return {
    placeOrder: mock(() => Promise.resolve({ orderId: "order-abc" })),
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
  status:
    | "submitting"
    | "pending"
    | "filled"
    | "settled_won"
    | "settled_lost"
    | "cancelled"
    | "failed";
  placedAt: Date;
  settledAt: Date | null;
  profit: number | null;
  errorMessage: string | null;
  errorCategory: BetErrorCategory | null;
  attempts: number;
  lastAttemptAt: Date | null;
};

function mockBetsRepo(existingBets: BetRow[] = []): BetsRepo {
  return {
    create: mock(() => Promise.resolve()),
    createIfNoActiveBet: mock(() => Promise.resolve("created" as const)),
    hasActiveBetForMarket: mock(() => Promise.resolve(false)),
    findById: mock(() => Promise.resolve(undefined)),
    findByCompetitor: mock(() => Promise.resolve(existingBets)),
    findByStatus: mock(() => Promise.resolve([])),
    updateStatus: mock(() => Promise.resolve()),
    updateBetAfterSubmission: mock(() => Promise.resolve()),
    findRetryableBets: mock(() => Promise.resolve([])),
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
    findAll: mock(() => Promise.resolve([])),
    findRecent: mock(() => Promise.resolve([])),
  } as unknown as BetsRepo;
}

function makeBetRow(overrides: Partial<BetRow> = {}): BetRow {
  return {
    id: "existing-bet",
    orderId: "order-old",
    marketId: "market-1",
    fixtureId: 1001,
    competitorId: "baseline",
    tokenId: "token_yes_123",
    side: "YES",
    amount: 5,
    price: 0.65,
    shares: 7.69,
    status: "pending",
    placedAt: new Date(),
    settledAt: null,
    profit: null,
    errorMessage: null,
    errorCategory: null,
    attempts: 0,
    lastAttemptAt: null,
    ...overrides,
  };
}

function makeInput(overrides?: Partial<PlaceBetInput>): PlaceBetInput {
  return {
    prediction: makePrediction(),
    resolvedStake: 5,
    market: makeMarket(),
    fixtureId: 1001,
    competitorId: "baseline",
    walletConfig: TEST_WALLET_CONFIG,
    ...overrides,
  };
}

describe("resolveTokenId", () => {
  it("returns tokenIds[0] for YES", () => {
    const market = makeMarket();
    expect(resolveTokenId(market, "YES")).toBe("token_yes_123");
  });

  it("returns tokenIds[1] for NO", () => {
    const market = makeMarket();
    expect(resolveTokenId(market, "NO")).toBe("token_no_456");
  });
});

describe("clampStake", () => {
  it("clamps to max when stake exceeds max", () => {
    expect(clampStake(15, 10)).toBe(10);
  });

  it("preserves stake within range", () => {
    expect(clampStake(5, 10)).toBe(5);
  });

  it("enforces minimum of 0.01", () => {
    expect(clampStake(0.001, 10)).toBe(0.01);
  });

  it("enforces minimum even with zero", () => {
    expect(clampStake(0, 10)).toBe(0.01);
  });
});

describe("createBettingService", () => {
  describe("write-ahead pattern", () => {
    it("creates bet row with submitting status BEFORE API call", async () => {
      const callOrder: string[] = [];
      const client = mockBettingClient({
        placeOrder: mock(() => {
          callOrder.push("placeOrder");
          return Promise.resolve({ orderId: "order-abc" });
        }),
      } as unknown as BettingClient);
      const repo = mockBetsRepo();
      (repo.createIfNoActiveBet as ReturnType<typeof mock>).mockImplementation((...args: unknown[]) => {
        callOrder.push("createIfNoActiveBet");
        return Promise.resolve("created" as const);
      });

      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig(),
      });

      await service.placeBet(makeInput());

      expect(callOrder).toEqual(["createIfNoActiveBet", "placeOrder"]);
      const createArg = (repo.createIfNoActiveBet as ReturnType<typeof mock>).mock
        .calls[0]?.[0] as Record<string, unknown>;
      expect(createArg.status).toBe("submitting");
    });

    it("updates row to pending with orderId on API success", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig(),
      });

      const result = await service.placeBet(makeInput());

      expect(result.status).toBe("placed");
      expect(repo.updateBetAfterSubmission).toHaveBeenCalledTimes(1);
      const [, update] = (repo.updateBetAfterSubmission as ReturnType<typeof mock>).mock
        .calls[0] as [string, { status: string; orderId: string }];
      expect(update.status).toBe("pending");
      expect(update.orderId).toBe("order-abc");
    });

    it("returns placed with correct bet details", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig(),
      });

      const result = await service.placeBet(makeInput());

      expect(result.status).toBe("placed");
      expect(result.bet).toBeDefined();
      expect(result.bet?.marketId).toBe("market-1");
      expect(result.bet?.competitorId).toBe("baseline");
      expect(result.bet?.side).toBe("YES");
      expect(result.bet?.amount).toBe(5);
      expect(result.bet?.price).toBe(0.65);
      expect(result.bet?.tokenId).toBe("token_yes_123");
      expect(result.bet?.orderId).toBe("order-abc");
    });

    it("calls bettingClient.placeOrder with correct params", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig(),
      });

      await service.placeBet(makeInput());

      expect(client.placeOrder).toHaveBeenCalledWith({
        tokenId: "token_yes_123",
        price: 0.65,
        amount: 5,
        side: "BUY",
      });
    });

    it("uses NO token and price for NO-side prediction", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig(),
      });

      await service.placeBet(makeInput({ prediction: makePrediction({ side: "NO" }) }));

      expect(client.placeOrder).toHaveBeenCalledWith({
        tokenId: "token_no_456",
        price: 0.35,
        amount: 5,
        side: "BUY",
      });
    });
  });

  describe("error handling", () => {
    it("updates row to failed on API error instead of throwing", async () => {
      const client = mockBettingClient({
        placeOrder: mock(() => Promise.reject(new Error("CLOB API error"))),
      } as unknown as BettingClient);
      const repo = mockBetsRepo();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig(),
      });

      const result = await service.placeBet(makeInput());

      expect(result.status).toBe("failed");
      expect(result.error).toContain("CLOB API error");
      expect(result.errorCategory).toBe("unknown");
    });

    it("records error details via updateBetAfterSubmission on failure", async () => {
      const client = mockBettingClient({
        placeOrder: mock(() => Promise.reject(new Error("connect ECONNREFUSED"))),
      } as unknown as BettingClient);
      const repo = mockBetsRepo();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig(),
      });

      await service.placeBet(makeInput());

      expect(repo.updateBetAfterSubmission).toHaveBeenCalledTimes(1);
      const [, update] = (repo.updateBetAfterSubmission as ReturnType<typeof mock>).mock
        .calls[0] as [
        string,
        { status: string; errorMessage: string; errorCategory: string; attempts: number },
      ];
      expect(update.status).toBe("failed");
      expect(update.errorMessage).toContain("ECONNREFUSED");
      expect(update.errorCategory).toBe("network_error");
      expect(update.attempts).toBe(1);
    });
  });

  describe("dry run", () => {
    it("returns dry_run status", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig({ dryRun: true }),
      });

      const result = await service.placeBet(makeInput());

      expect(result.status).toBe("dry_run");
    });

    it("does not call bettingClient.placeOrder", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig({ dryRun: true }),
      });

      await service.placeBet(makeInput());

      expect(client.placeOrder).not.toHaveBeenCalled();
    });

    it("does not call betsRepo.createIfNoActiveBet", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig({ dryRun: true }),
      });

      await service.placeBet(makeInput());

      expect(repo.createIfNoActiveBet).not.toHaveBeenCalled();
    });
  });

  describe("skip conditions", () => {
    it("skips when market is not accepting orders", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig(),
      });

      const result = await service.placeBet(
        makeInput({ market: makeMarket({ acceptingOrders: false }) }),
      );

      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("not accepting orders");
      expect(client.placeOrder).not.toHaveBeenCalled();
    });

    it("skips when duplicate pending bet exists", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo([makeBetRow({ status: "pending" })]);
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig(),
      });

      const result = await service.placeBet(makeInput());

      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("already exists");
      expect(client.placeOrder).not.toHaveBeenCalled();
    });

    it("skips when duplicate filled bet exists", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo([makeBetRow({ status: "filled" })]);
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig(),
      });

      const result = await service.placeBet(makeInput());

      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("already exists");
    });

    it("skips when duplicate submitting bet exists (anti-double-bet)", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo([makeBetRow({ status: "submitting", orderId: null })]);
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig(),
      });

      const result = await service.placeBet(makeInput());

      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("already exists");
      expect(repo.createIfNoActiveBet).not.toHaveBeenCalled();
      expect(client.placeOrder).not.toHaveBeenCalled();
    });

    it("does not skip for settled bets on same market", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo([makeBetRow({ status: "settled_won", profit: 2.5 })]);
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig(),
      });

      const result = await service.placeBet(makeInput());

      expect(result.status).toBe("placed");
    });

    it("does not skip for failed bet on same market (allows re-bet)", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo([
        makeBetRow({ status: "failed", errorMessage: "timeout", errorCategory: "network_error" }),
      ]);
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig(),
      });

      const result = await service.placeBet(makeInput());

      expect(result.status).toBe("placed");
    });

    it("does not skip for cancelled bet on same market", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo([makeBetRow({ status: "cancelled" })]);
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig(),
      });

      const result = await service.placeBet(makeInput());

      expect(result.status).toBe("placed");
    });

    it("skips when budget would be exceeded", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo([
        makeBetRow({ marketId: "market-other", amount: 98, status: "pending" }),
      ]);
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig({ maxTotalExposure: 100 }),
      });

      const result = await service.placeBet(makeInput());

      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("exposure");
      expect(client.placeOrder).not.toHaveBeenCalled();
    });
  });

  describe("exposure calculation", () => {
    it("submitting bets count toward exposure", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo([
        makeBetRow({ marketId: "market-other", amount: 98, status: "submitting", orderId: null }),
      ]);
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig({ maxTotalExposure: 100 }),
      });

      const result = await service.placeBet(makeInput());

      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("exposure");
    });
  });

  describe("atomic duplicate prevention via createIfNoActiveBet", () => {
    it("returns skipped when createIfNoActiveBet returns duplicate", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      (repo as unknown as Record<string, unknown>).createIfNoActiveBet = mock(() =>
        Promise.resolve("duplicate" as const),
      );
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig(),
      });

      const result = await service.placeBet(makeInput());

      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("already exists");
      expect(client.placeOrder).not.toHaveBeenCalled();
    });

    it("proceeds to API call when createIfNoActiveBet returns created", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      (repo as unknown as Record<string, unknown>).createIfNoActiveBet = mock(() =>
        Promise.resolve("created" as const),
      );
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig(),
      });

      const result = await service.placeBet(makeInput());

      expect(result.status).toBe("placed");
      expect(client.placeOrder).toHaveBeenCalled();
    });

    it("calls createIfNoActiveBet instead of create for write-ahead", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      const createIfNoActiveBet = mock(() => Promise.resolve("created" as const));
      (repo as unknown as Record<string, unknown>).createIfNoActiveBet = createIfNoActiveBet;
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig(),
      });

      await service.placeBet(makeInput());

      expect(createIfNoActiveBet).toHaveBeenCalledTimes(1);
      const arg = (createIfNoActiveBet.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
      expect(arg.status).toBe("submitting");
      expect(arg.orderId).toBeNull();
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe("stake clamping", () => {
    it("clamps stake to maxStakePerBet", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: mockAuditLog(),
        config: makeConfig({ maxStakePerBet: 3 }),
      });

      await service.placeBet(makeInput({ resolvedStake: 10 }));

      const callArg = (client.placeOrder as ReturnType<typeof mock>).mock.calls[0]?.[0] as {
        amount: number;
      };
      expect(callArg.amount).toBe(3);
    });
  });

  describe("audit logging", () => {
    it("records bet_created and order_submitted on success", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      const audit = mockAuditLog();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: audit,
        config: makeConfig(),
      });

      await service.placeBet(makeInput());

      expect(audit.safeRecord).toHaveBeenCalledTimes(2);
      const calls = (audit.safeRecord as ReturnType<typeof mock>).mock.calls as unknown[][];
      const first = calls[0]![0] as Record<string, unknown>;
      expect(first.event).toBe("bet_created");
      expect(first.statusBefore).toBeNull();
      expect(first.statusAfter).toBe("submitting");

      const second = calls[1]![0] as Record<string, unknown>;
      expect(second.event).toBe("order_submitted");
      expect(second.statusBefore).toBe("submitting");
      expect(second.statusAfter).toBe("pending");
      expect(second.orderId).toBe("order-abc");
    });

    it("records bet_created and order_failed on failure", async () => {
      const client = mockBettingClient({
        placeOrder: mock(() => Promise.reject(new Error("API error"))),
      } as unknown as BettingClient);
      const repo = mockBetsRepo();
      const audit = mockAuditLog();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: audit,
        config: makeConfig(),
      });

      await service.placeBet(makeInput());

      expect(audit.safeRecord).toHaveBeenCalledTimes(2);
      const calls = (audit.safeRecord as ReturnType<typeof mock>).mock.calls as unknown[][];
      const first = calls[0]![0] as Record<string, unknown>;
      expect(first.event).toBe("bet_created");

      const second = calls[1]![0] as Record<string, unknown>;
      expect(second.event).toBe("order_failed");
      expect(second.statusBefore).toBe("submitting");
      expect(second.statusAfter).toBe("failed");
      expect(second.error).toContain("API error");
      expect(second.errorCategory).toBe("unknown");
    });

    it("does not record audit for skipped bets", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      const audit = mockAuditLog();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        auditLog: audit,
        config: makeConfig(),
      });

      await service.placeBet(makeInput({ market: makeMarket({ acceptingOrders: false }) }));

      expect(audit.safeRecord).not.toHaveBeenCalled();
    });
  });
});
