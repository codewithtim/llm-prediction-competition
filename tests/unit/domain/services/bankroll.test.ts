import { describe, expect, it, mock } from "bun:test";
import { createBankrollProvider } from "../../../../src/domain/services/bankroll";
import type { betsRepo as betsRepoFactory } from "../../../../src/infrastructure/database/repositories/bets";

type BetsRepo = ReturnType<typeof betsRepoFactory>;

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
  status: "submitting" | "pending" | "filled" | "settled_won" | "settled_lost" | "cancelled" | "failed";
  placedAt: Date;
  settledAt: Date | null;
  profit: number | null;
  errorMessage: string | null;
  errorCategory: string | null;
  attempts: number;
  lastAttemptAt: Date | null;
};

function makeBet(overrides: Partial<BetRow> = {}): BetRow {
  return {
    id: crypto.randomUUID(),
    orderId: "order-1",
    marketId: "market-1",
    fixtureId: 100,
    competitorId: "comp-1",
    tokenId: "tok-1",
    side: "YES",
    amount: 5,
    price: 0.6,
    shares: 8.33,
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

function mockBetsRepo(bets: BetRow[] = []): BetsRepo {
  return {
    findByCompetitor: mock(() => Promise.resolve(bets)),
  } as unknown as BetsRepo;
}

describe("createBankrollProvider", () => {
  it("returns initial bankroll when no bets exist", async () => {
    const provider = createBankrollProvider({
      betsRepo: mockBetsRepo([]),
      initialBankroll: 100,
    });

    const bankroll = await provider.getBankroll("comp-1");
    expect(bankroll).toBe(100);
  });

  it("subtracts pending bet exposure from bankroll", async () => {
    const provider = createBankrollProvider({
      betsRepo: mockBetsRepo([
        makeBet({ amount: 10, status: "pending" }),
        makeBet({ amount: 5, status: "filled" }),
      ]),
      initialBankroll: 100,
    });

    const bankroll = await provider.getBankroll("comp-1");
    expect(bankroll).toBe(85); // 100 - 10 - 5
  });

  it("adds settled profits to bankroll", async () => {
    const provider = createBankrollProvider({
      betsRepo: mockBetsRepo([makeBet({ amount: 10, status: "settled_won", profit: 8 })]),
      initialBankroll: 100,
    });

    const bankroll = await provider.getBankroll("comp-1");
    expect(bankroll).toBe(108); // 100 + 8
  });

  it("subtracts settled losses from bankroll", async () => {
    const provider = createBankrollProvider({
      betsRepo: mockBetsRepo([makeBet({ amount: 10, status: "settled_lost", profit: -10 })]),
      initialBankroll: 100,
    });

    const bankroll = await provider.getBankroll("comp-1");
    expect(bankroll).toBe(90); // 100 + (-10)
  });

  it("combines settled P&L and pending exposure", async () => {
    const provider = createBankrollProvider({
      betsRepo: mockBetsRepo([
        makeBet({ amount: 10, status: "settled_won", profit: 8 }),
        makeBet({ amount: 5, status: "settled_lost", profit: -5 }),
        makeBet({ amount: 15, status: "pending" }),
      ]),
      initialBankroll: 100,
    });

    const bankroll = await provider.getBankroll("comp-1");
    // 100 + 8 + (-5) - 15 = 88
    expect(bankroll).toBe(88);
  });

  it("returns zero when bankroll would go negative", async () => {
    const provider = createBankrollProvider({
      betsRepo: mockBetsRepo([
        makeBet({ amount: 50, status: "settled_lost", profit: -50 }),
        makeBet({ amount: 60, status: "settled_lost", profit: -60 }),
      ]),
      initialBankroll: 100,
    });

    const bankroll = await provider.getBankroll("comp-1");
    expect(bankroll).toBe(0); // max(0, 100 + (-50) + (-60))
  });

  it("ignores cancelled bets", async () => {
    const provider = createBankrollProvider({
      betsRepo: mockBetsRepo([makeBet({ amount: 50, status: "cancelled" })]),
      initialBankroll: 100,
    });

    const bankroll = await provider.getBankroll("comp-1");
    expect(bankroll).toBe(100);
  });

  it("submitting bet deducts from bankroll (locked capital)", async () => {
    const provider = createBankrollProvider({
      betsRepo: mockBetsRepo([makeBet({ amount: 10, status: "submitting" })]),
      initialBankroll: 100,
    });

    const bankroll = await provider.getBankroll("comp-1");
    expect(bankroll).toBe(90); // 100 - 10
  });

  it("failed bet does NOT deduct from bankroll (capital released)", async () => {
    const provider = createBankrollProvider({
      betsRepo: mockBetsRepo([makeBet({ amount: 10, status: "failed" })]),
      initialBankroll: 100,
    });

    const bankroll = await provider.getBankroll("comp-1");
    expect(bankroll).toBe(100);
  });
});
