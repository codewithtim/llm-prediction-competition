import { describe, expect, it, mock } from "bun:test";
import {
  calculateProfit,
  createSettlementService,
  determineWinningOutcome,
} from "../../../../src/domain/services/settlement";
import type { betsRepo as betsRepoFactory } from "../../../../src/infrastructure/database/repositories/bets";
import type { marketsRepo as marketsRepoFactory } from "../../../../src/infrastructure/database/repositories/markets";
import type { GammaClient } from "../../../../src/infrastructure/polymarket/gamma-client";
import type { GammaMarket } from "../../../../src/infrastructure/polymarket/types";

type BetsRepo = ReturnType<typeof betsRepoFactory>;
type MarketsRepo = ReturnType<typeof marketsRepoFactory>;

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

type MarketRow = {
  id: string;
  conditionId: string;
  slug: string;
  question: string;
  outcomes: [string, string];
  outcomePrices: [string, string];
  tokenIds: [string, string];
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean;
  liquidity: number;
  volume: number;
  gameId: string | null;
  sportsMarketType: string | null;
  line: number | null;
  createdAt: Date;
  updatedAt: Date;
};

function makeBetRow(overrides?: Partial<BetRow>): BetRow {
  return {
    id: "bet-1",
    orderId: "order-1",
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
    ...overrides,
  };
}

function makeMarketRow(overrides?: Partial<MarketRow>): MarketRow {
  return {
    id: "market-1",
    conditionId: "0xabc",
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeGammaMarket(overrides?: Partial<GammaMarket>): GammaMarket {
  return {
    id: "market-1",
    question: "Will Arsenal win?",
    conditionId: "0xabc",
    slug: "will-arsenal-win",
    outcomes: '["Yes","No"]',
    outcomePrices: '["1","0"]',
    clobTokenIds: '["token_yes_123","token_no_456"]',
    active: false,
    closed: true,
    acceptingOrders: false,
    liquidity: "0",
    liquidityNum: 0,
    volume: "50000",
    volumeNum: 50000,
    gameId: "12345",
    sportsMarketType: "moneyline",
    bestBid: 0,
    bestAsk: 0,
    lastTradePrice: 1,
    orderPriceMinTickSize: 0.01,
    orderMinSize: 1,
    ...overrides,
  };
}

function mockGammaClient(overrides?: Partial<GammaClient>): GammaClient {
  return {
    getSports: mock(() => Promise.resolve([])),
    getEvents: mock(() => Promise.resolve([])),
    getMarketById: mock(() => Promise.resolve(makeGammaMarket())),
    ...overrides,
  } as unknown as GammaClient;
}

function mockBetsRepo(pendingBets: BetRow[] = [], filledBets: BetRow[] = []): BetsRepo {
  return {
    create: mock(() => Promise.resolve()),
    findById: mock(() => Promise.resolve(undefined)),
    findByCompetitor: mock(() => Promise.resolve([])),
    findByStatus: mock((status: string) => {
      if (status === "pending") return Promise.resolve(pendingBets);
      if (status === "filled") return Promise.resolve(filledBets);
      return Promise.resolve([]);
    }),
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

function mockMarketsRepo(markets: MarketRow[] = []): MarketsRepo {
  const marketMap = new Map(markets.map((m) => [m.id, m]));
  return {
    upsert: mock(() => Promise.resolve()),
    findById: mock((id: string) => Promise.resolve(marketMap.get(id))),
    findActive: mock(() => Promise.resolve([])),
    findByGameId: mock(() => Promise.resolve([])),
  } as unknown as MarketsRepo;
}

describe("determineWinningOutcome", () => {
  it('returns "YES" when outcomePrices is ["1", "0"]', () => {
    expect(determineWinningOutcome(["1", "0"])).toBe("YES");
  });

  it('returns "NO" when outcomePrices is ["0", "1"]', () => {
    expect(determineWinningOutcome(["0", "1"])).toBe("NO");
  });

  it("returns null for unresolved prices", () => {
    expect(determineWinningOutcome(["0.6", "0.4"])).toBeNull();
  });

  it('handles threshold - ["0.99", "0.01"] returns "YES"', () => {
    expect(determineWinningOutcome(["0.99", "0.01"])).toBe("YES");
  });

  it('handles threshold - ["0.01", "0.995"] returns "NO"', () => {
    expect(determineWinningOutcome(["0.01", "0.995"])).toBe("NO");
  });

  it("returns null for balanced prices", () => {
    expect(determineWinningOutcome(["0.5", "0.5"])).toBeNull();
  });
});

describe("calculateProfit", () => {
  it("returns positive profit for winning bet", () => {
    // $5 at price 0.5 → shares = 10, pays $10, profit = $5
    expect(calculateProfit(5, 0.5, true)).toBe(5);
  });

  it("returns correct profit for different price", () => {
    // $10 at price 0.65 → profit = 10 * (0.35 / 0.65) ≈ 5.3846
    const profit = calculateProfit(10, 0.65, true);
    expect(profit).toBeCloseTo(5.3846, 3);
  });

  it("returns -amount for losing bet", () => {
    expect(calculateProfit(5, 0.65, false)).toBe(-5);
  });

  it("returns -amount for losing bet regardless of price", () => {
    expect(calculateProfit(10, 0.3, false)).toBe(-10);
  });
});

describe("createSettlementService", () => {
  describe("happy path", () => {
    it("settles a winning YES bet correctly", async () => {
      const bet = makeBetRow({ side: "YES", amount: 5, price: 0.65 });
      const market = makeMarketRow({ id: "market-1", closed: false });
      const gamma = mockGammaClient({
        getMarketById: mock(() => Promise.resolve(makeGammaMarket({ outcomePrices: '["1","0"]' }))),
      });
      const bets = mockBetsRepo([bet]);
      const markets = mockMarketsRepo([market]);

      const service = createSettlementService({
        gammaClient: gamma,
        betsRepo: bets,
        marketsRepo: markets,
      });

      const result = await service.settleBets();

      expect(result.settled).toHaveLength(1);
      expect(result.settled[0]?.outcome).toBe("won");
      expect(result.settled[0]?.profit).toBeCloseTo(2.6923, 3);
      expect(bets.updateStatus).toHaveBeenCalledTimes(1);
    });

    it("settles a losing YES bet correctly", async () => {
      const bet = makeBetRow({ side: "YES", amount: 5, price: 0.65 });
      const market = makeMarketRow({ id: "market-1", closed: false });
      const gamma = mockGammaClient({
        getMarketById: mock(() => Promise.resolve(makeGammaMarket({ outcomePrices: '["0","1"]' }))),
      });
      const bets = mockBetsRepo([bet]);
      const markets = mockMarketsRepo([market]);

      const service = createSettlementService({
        gammaClient: gamma,
        betsRepo: bets,
        marketsRepo: markets,
      });

      const result = await service.settleBets();

      expect(result.settled).toHaveLength(1);
      expect(result.settled[0]?.outcome).toBe("lost");
      expect(result.settled[0]?.profit).toBe(-5);
    });

    it("settles a winning NO bet correctly", async () => {
      const bet = makeBetRow({
        side: "NO",
        tokenId: "token_no_456",
        amount: 5,
        price: 0.35,
      });
      const market = makeMarketRow({ id: "market-1", closed: false });
      const gamma = mockGammaClient({
        getMarketById: mock(() => Promise.resolve(makeGammaMarket({ outcomePrices: '["0","1"]' }))),
      });
      const bets = mockBetsRepo([bet]);
      const markets = mockMarketsRepo([market]);

      const service = createSettlementService({
        gammaClient: gamma,
        betsRepo: bets,
        marketsRepo: markets,
      });

      const result = await service.settleBets();

      expect(result.settled).toHaveLength(1);
      expect(result.settled[0]?.outcome).toBe("won");
      expect(result.settled[0]?.profit).toBeCloseTo(9.2857, 3);
    });

    it("settles multiple bets on the same resolved market", async () => {
      const bet1 = makeBetRow({ id: "bet-1", competitorId: "comp-a", side: "YES" });
      const bet2 = makeBetRow({ id: "bet-2", competitorId: "comp-b", side: "NO" });
      const market = makeMarketRow({ id: "market-1", closed: false });
      const gamma = mockGammaClient({
        getMarketById: mock(() => Promise.resolve(makeGammaMarket({ outcomePrices: '["1","0"]' }))),
      });
      const bets = mockBetsRepo([bet1, bet2]);
      const markets = mockMarketsRepo([market]);

      const service = createSettlementService({
        gammaClient: gamma,
        betsRepo: bets,
        marketsRepo: markets,
      });

      const result = await service.settleBets();

      expect(result.settled).toHaveLength(2);
      const won = result.settled.find((s) => s.outcome === "won");
      const lost = result.settled.find((s) => s.outcome === "lost");
      expect(won?.competitorId).toBe("comp-a");
      expect(lost?.competitorId).toBe("comp-b");
    });

    it("uses already-closed market from DB without Gamma call", async () => {
      const bet = makeBetRow({ side: "YES" });
      const market = makeMarketRow({
        id: "market-1",
        closed: true,
        outcomePrices: ["1", "0"] as [string, string],
      });
      const gamma = mockGammaClient();
      const bets = mockBetsRepo([bet]);
      const markets = mockMarketsRepo([market]);

      const service = createSettlementService({
        gammaClient: gamma,
        betsRepo: bets,
        marketsRepo: markets,
      });

      const result = await service.settleBets();

      expect(result.settled).toHaveLength(1);
      expect(gamma.getMarketById).not.toHaveBeenCalled();
    });

    it("updates market record to closed after resolution", async () => {
      const bet = makeBetRow();
      const market = makeMarketRow({ id: "market-1", closed: false });
      const gamma = mockGammaClient();
      const bets = mockBetsRepo([bet]);
      const markets = mockMarketsRepo([market]);

      const service = createSettlementService({
        gammaClient: gamma,
        betsRepo: bets,
        marketsRepo: markets,
      });

      await service.settleBets();

      expect(markets.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe("skip conditions", () => {
    it("skips bets whose market is not yet resolved", async () => {
      const bet = makeBetRow();
      const market = makeMarketRow({ id: "market-1", closed: false });
      const gamma = mockGammaClient({
        getMarketById: mock(() =>
          Promise.resolve(
            makeGammaMarket({
              closed: false,
              outcomePrices: '["0.6","0.4"]',
            }),
          ),
        ),
      });
      const bets = mockBetsRepo([bet]);
      const markets = mockMarketsRepo([market]);

      const service = createSettlementService({
        gammaClient: gamma,
        betsRepo: bets,
        marketsRepo: markets,
      });

      const result = await service.settleBets();

      expect(result.settled).toHaveLength(0);
      expect(result.skipped).toBe(1);
      expect(bets.updateStatus).not.toHaveBeenCalled();
    });

    it("returns empty result when no unsettled bets exist", async () => {
      const gamma = mockGammaClient();
      const bets = mockBetsRepo();
      const markets = mockMarketsRepo();

      const service = createSettlementService({
        gammaClient: gamma,
        betsRepo: bets,
        marketsRepo: markets,
      });

      const result = await service.settleBets();

      expect(result.settled).toHaveLength(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it("skips when Gamma returns null for unknown market", async () => {
      const bet = makeBetRow();
      const market = makeMarketRow({ id: "market-1", closed: false });
      const gamma = mockGammaClient({
        getMarketById: mock(() => Promise.resolve(null)),
      });
      const bets = mockBetsRepo([bet]);
      const markets = mockMarketsRepo([market]);

      const service = createSettlementService({
        gammaClient: gamma,
        betsRepo: bets,
        marketsRepo: markets,
      });

      const result = await service.settleBets();

      expect(result.settled).toHaveLength(0);
      expect(result.skipped).toBe(1);
    });
  });

  describe("error handling", () => {
    it("records error when market not found in DB", async () => {
      const bet = makeBetRow({ marketId: "nonexistent" });
      const gamma = mockGammaClient();
      const bets = mockBetsRepo([bet]);
      const markets = mockMarketsRepo();

      const service = createSettlementService({
        gammaClient: gamma,
        betsRepo: bets,
        marketsRepo: markets,
      });

      const result = await service.settleBets();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("nonexistent");
      expect(result.errors[0]).toContain("not found");
    });

    it("continues processing after Gamma API error", async () => {
      const bet1 = makeBetRow({ id: "bet-1", marketId: "market-bad" });
      const bet2 = makeBetRow({ id: "bet-2", marketId: "market-good" });
      const marketBad = makeMarketRow({ id: "market-bad", closed: false });
      const marketGood = makeMarketRow({ id: "market-good", closed: false });

      const gamma = mockGammaClient({
        getMarketById: mock((id: string) => {
          if (id === "market-bad") return Promise.reject(new Error("API down"));
          return Promise.resolve(makeGammaMarket({ id: "market-good" }));
        }),
      });
      const bets = mockBetsRepo([bet1, bet2]);
      const markets = mockMarketsRepo([marketBad, marketGood]);

      const service = createSettlementService({
        gammaClient: gamma,
        betsRepo: bets,
        marketsRepo: markets,
      });

      const result = await service.settleBets();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("market-bad");
      expect(result.settled).toHaveLength(1);
      expect(result.settled[0]?.betId).toBe("bet-2");
    });
  });

  describe("filled bets", () => {
    it("settles filled bets alongside pending bets", async () => {
      const pendingBet = makeBetRow({ id: "bet-pending", status: "pending" });
      const filledBet = makeBetRow({ id: "bet-filled", status: "filled" });
      const market = makeMarketRow({ id: "market-1", closed: false });
      const gamma = mockGammaClient();
      const bets = mockBetsRepo([pendingBet], [filledBet]);
      const markets = mockMarketsRepo([market]);

      const service = createSettlementService({
        gammaClient: gamma,
        betsRepo: bets,
        marketsRepo: markets,
      });

      const result = await service.settleBets();

      expect(result.settled).toHaveLength(2);
      expect(bets.updateStatus).toHaveBeenCalledTimes(2);
    });
  });
});
