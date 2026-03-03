import { describe, expect, test } from "bun:test";
import { toBetSummary, type BetLookups } from "../../../src/api/mappers";

function makeBetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1",
    competitorId: "c1",
    marketId: "m1",
    fixtureId: 1001,
    side: "YES" as const,
    amount: 10,
    price: 0.65,
    shares: 15.38,
    status: "pending" as const,
    placedAt: new Date("2026-01-15T10:00:00Z"),
    settledAt: null,
    profit: null,
    errorMessage: null,
    errorCategory: null,
    attempts: 0,
    lastAttemptAt: null,
    orderId: null,
    tokenId: "tok1",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeLookups(overrides: Partial<BetLookups> = {}): BetLookups {
  return {
    competitorMap: new Map([["c1", "Claude"]]),
    marketById: new Map([
      [
        "m1",
        {
          question: "Will Arsenal win?",
          polymarketUrl: "https://polymarket.com/sports/epl/epl-ars-che-2026-03-15",
        },
      ],
    ]),
    predictionMap: new Map([["c1:m1:YES", 0.82]]),
    ...overrides,
  };
}

describe("toBetSummary", () => {
  test("maps all fields including polymarketUrl", () => {
    const result = toBetSummary(makeBetRow() as any, makeLookups());

    expect(result.id).toBe("b1");
    expect(result.competitorName).toBe("Claude");
    expect(result.marketQuestion).toBe("Will Arsenal win?");
    expect(result.polymarketUrl).toBe("https://polymarket.com/sports/epl/epl-ars-che-2026-03-15");
    expect(result.side).toBe("YES");
    expect(result.amount).toBe(10);
    expect(result.price).toBe(0.65);
    expect(result.confidence).toBe(0.82);
    expect(result.errorMessage).toBeNull();
    expect(result.errorCategory).toBeNull();
    expect(result.attempts).toBe(0);
  });

  test("returns null polymarketUrl when market has no URL", () => {
    const lookups = makeLookups({
      marketById: new Map([["m1", { question: "Will Arsenal win?", polymarketUrl: null }]]),
    });

    const result = toBetSummary(makeBetRow() as any, lookups);
    expect(result.polymarketUrl).toBeNull();
    expect(result.marketQuestion).toBe("Will Arsenal win?");
  });

  test("returns null polymarketUrl when market not found", () => {
    const lookups = makeLookups({
      marketById: new Map(),
    });

    const result = toBetSummary(makeBetRow() as any, lookups);
    expect(result.polymarketUrl).toBeNull();
    expect(result.marketQuestion).toBe("Unknown");
  });

  test("maps error fields for failed bets", () => {
    const result = toBetSummary(
      makeBetRow({
        status: "failed",
        errorMessage: "insufficient balance",
        errorCategory: "insufficient_funds",
        attempts: 3,
      }) as any,
      makeLookups(),
    );

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("insufficient balance");
    expect(result.errorCategory).toBe("insufficient_funds");
    expect(result.attempts).toBe(3);
  });

  test("returns Unknown for missing competitor", () => {
    const lookups = makeLookups({
      competitorMap: new Map(),
    });

    const result = toBetSummary(makeBetRow() as any, lookups);
    expect(result.competitorName).toBe("Unknown");
  });

  test("returns null confidence when no prediction matches", () => {
    const lookups = makeLookups({
      predictionMap: new Map(),
    });

    const result = toBetSummary(makeBetRow() as any, lookups);
    expect(result.confidence).toBeNull();
  });
});
