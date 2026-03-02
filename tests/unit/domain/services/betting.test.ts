import { describe, expect, it, mock } from "bun:test";
import type { PredictionOutput } from "../../../../src/domain/contracts/prediction";
import type { Market } from "../../../../src/domain/models/market";
import {
  type BettingConfig,
  clampStake,
  createBettingService,
  type PlaceBetInput,
  resolveTokenId,
} from "../../../../src/domain/services/betting";
import type { WalletConfig } from "../../../../src/domain/types/competitor";
import type { betsRepo as betsRepoFactory } from "../../../../src/infrastructure/database/repositories/bets";
import type { BettingClient } from "../../../../src/infrastructure/polymarket/betting-client";
import type { BettingClientFactory } from "../../../../src/infrastructure/polymarket/betting-client-factory";

type BetsRepo = ReturnType<typeof betsRepoFactory>;

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
  orderId: string;
  marketId: string;
  fixtureId: number;
  competitorId: string;
  tokenId: string;
  side: "YES" | "NO";
  amount: number;
  price: number;
  shares: number;
  status: "pending" | "filled" | "settled_won" | "settled_lost" | "cancelled";
  placedAt: Date;
  settledAt: Date | null;
  profit: number | null;
};

function mockBetsRepo(existingBets: BetRow[] = []): BetsRepo {
  return {
    create: mock(() => Promise.resolve()),
    findById: mock(() => Promise.resolve(undefined)),
    findByCompetitor: mock(() => Promise.resolve(existingBets)),
    findByStatus: mock(() => Promise.resolve([])),
    updateStatus: mock(() => Promise.resolve()),
    getPerformanceStats: mock(() =>
      Promise.resolve({
        competitorId: "",
        totalBets: 0,
        wins: 0,
        losses: 0,
        pending: 0,
        totalStaked: 0,
        totalReturned: 0,
        profitLoss: 0,
        accuracy: 0,
        roi: 0,
      }),
    ),
  } as unknown as BetsRepo;
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
  describe("happy path", () => {
    it("places bet and returns placed status with bet details", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
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

    it("records bet in betsRepo", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        config: makeConfig(),
      });

      await service.placeBet(makeInput());

      expect(repo.create).toHaveBeenCalledTimes(1);
      const createArg = (repo.create as ReturnType<typeof mock>).mock.calls[0]?.[0] as BetRow;
      expect(createArg.marketId).toBe("market-1");
      expect(createArg.status).toBe("pending");
      expect(createArg.amount).toBe(5);
    });

    it("uses NO token and price for NO-side prediction", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
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

  describe("dry run", () => {
    it("returns dry_run status", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
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
        config: makeConfig({ dryRun: true }),
      });

      await service.placeBet(makeInput());

      expect(client.placeOrder).not.toHaveBeenCalled();
    });

    it("does not call betsRepo.create", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        config: makeConfig({ dryRun: true }),
      });

      await service.placeBet(makeInput());

      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe("skip conditions", () => {
    it("skips when market is not accepting orders", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
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
      const repo = mockBetsRepo([
        {
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
        },
      ]);
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        config: makeConfig(),
      });

      const result = await service.placeBet(makeInput());

      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("already exists");
      expect(client.placeOrder).not.toHaveBeenCalled();
    });

    it("skips when duplicate filled bet exists", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo([
        {
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
          status: "filled",
          placedAt: new Date(),
          settledAt: null,
          profit: null,
        },
      ]);
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        config: makeConfig(),
      });

      const result = await service.placeBet(makeInput());

      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("already exists");
    });

    it("does not skip for settled bets on same market", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo([
        {
          id: "old-bet",
          orderId: "order-old",
          marketId: "market-1",
          fixtureId: 1001,
          competitorId: "baseline",
          tokenId: "token_yes_123",
          side: "YES",
          amount: 5,
          price: 0.65,
          shares: 7.69,
          status: "settled_won",
          placedAt: new Date(),
          settledAt: new Date(),
          profit: 2.5,
        },
      ]);
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        config: makeConfig(),
      });

      const result = await service.placeBet(makeInput());

      expect(result.status).toBe("placed");
    });

    it("skips when budget would be exceeded", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo([
        {
          id: "big-bet",
          orderId: "order-big",
          marketId: "market-other",
          fixtureId: 999,
          competitorId: "baseline",
          tokenId: "token_x",
          side: "YES",
          amount: 98,
          price: 0.5,
          shares: 196,
          status: "pending",
          placedAt: new Date(),
          settledAt: null,
          profit: null,
        },
      ]);
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        config: makeConfig({ maxTotalExposure: 100 }),
      });

      const result = await service.placeBet(makeInput());

      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("exposure");
      expect(client.placeOrder).not.toHaveBeenCalled();
    });
  });

  describe("stake clamping", () => {
    it("clamps stake to maxStakePerBet", async () => {
      const client = mockBettingClient();
      const repo = mockBetsRepo();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        config: makeConfig({ maxStakePerBet: 3 }),
      });

      await service.placeBet(makeInput({ resolvedStake: 10 }));

      const callArg = (client.placeOrder as ReturnType<typeof mock>).mock.calls[0]?.[0] as {
        amount: number;
      };
      expect(callArg.amount).toBe(3);
    });
  });

  describe("error handling", () => {
    it("propagates errors from bettingClient.placeOrder", async () => {
      const client = mockBettingClient({
        placeOrder: mock(() => Promise.reject(new Error("CLOB API error"))),
      } as unknown as BettingClient);
      const repo = mockBetsRepo();
      const service = createBettingService({
        bettingClientFactory: mockBettingClientFactory(client),
        betsRepo: repo,
        config: makeConfig(),
      });

      await expect(service.placeBet(makeInput())).rejects.toThrow("CLOB API error");
    });
  });
});
