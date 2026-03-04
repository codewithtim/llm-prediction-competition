import { describe, expect, test } from "bun:test";
import {
  mapGammaEventToEvent,
  mapGammaMarketToMarket,
} from "../../../../src/apis/polymarket/mappers.ts";
import type { GammaEvent, GammaMarket } from "../../../../src/apis/polymarket/types.ts";

function makeGammaMarket(overrides: Partial<GammaMarket> = {}): GammaMarket {
  return {
    id: "1400768",
    question: "Will Tottenham Hotspur FC win on 2026-03-05?",
    conditionId: "0xabc123",
    slug: "will-tottenham-win",
    outcomes: '["Yes", "No"]',
    outcomePrices: '["0.405", "0.595"]',
    clobTokenIds: '["token_yes_123", "token_no_456"]',
    active: true,
    closed: false,
    acceptingOrders: true,
    liquidity: "5000.00",
    liquidityNum: 5000,
    volume: "12345.67",
    volumeNum: 12345.67,
    gameId: "90091280",
    sportsMarketType: "moneyline",
    bestBid: 0.39,
    bestAsk: 0.42,
    lastTradePrice: 0.41,
    orderPriceMinTickSize: 0.01,
    orderMinSize: 5,
    ...overrides,
  };
}

function makeGammaEvent(overrides: Partial<GammaEvent> = {}): GammaEvent {
  return {
    id: "218306",
    title: "Tottenham Hotspur FC vs. Crystal Palace FC",
    slug: "epl-tot-cry-2026-03-05",
    startDate: "2026-02-14T05:11:37Z",
    endDate: "2026-03-06T00:00:00Z",
    active: true,
    closed: false,
    seriesSlug: "premier-league-2025",
    eventDate: "2026-03-05",
    startTime: "2026-03-05T20:00:00Z",
    score: "",
    elapsed: "",
    period: "",
    gameId: 90091280,
    markets: [makeGammaMarket()],
    ...overrides,
  };
}

describe("mapGammaMarketToMarket", () => {
  test("parses JSON string fields into arrays", () => {
    const result = mapGammaMarketToMarket(makeGammaMarket());
    expect(result).not.toBeNull();

    expect(result?.outcomes).toEqual(["Yes", "No"]);
    expect(result?.outcomePrices).toEqual(["0.405", "0.595"]);
    expect(result?.tokenIds).toEqual(["token_yes_123", "token_no_456"]);
  });

  test("maps scalar fields correctly", () => {
    const result = mapGammaMarketToMarket(makeGammaMarket());
    expect(result).not.toBeNull();

    expect(result?.id).toBe("1400768");
    expect(result?.conditionId).toBe("0xabc123");
    expect(result?.slug).toBe("will-tottenham-win");
    expect(result?.question).toBe("Will Tottenham Hotspur FC win on 2026-03-05?");
    expect(result?.active).toBe(true);
    expect(result?.closed).toBe(false);
    expect(result?.acceptingOrders).toBe(true);
    expect(result?.liquidity).toBe(5000);
    expect(result?.volume).toBe(12345.67);
    expect(result?.gameId).toBe("90091280");
    expect(result?.sportsMarketType).toBe("moneyline");
    expect(result?.line).toBeNull();
    expect(result?.polymarketUrl).toBeNull();
  });

  test("handles null gameId and sportsMarketType", () => {
    const result = mapGammaMarketToMarket(
      makeGammaMarket({ gameId: null, sportsMarketType: null }),
    );
    expect(result).not.toBeNull();

    expect(result?.gameId).toBeNull();
    expect(result?.sportsMarketType).toBeNull();
  });

  test("handles undefined gameId and sportsMarketType as null", () => {
    const raw = makeGammaMarket();
    // Simulate API returning undefined (field missing from JSON)
    (raw as Record<string, unknown>).gameId = undefined;
    (raw as Record<string, unknown>).sportsMarketType = undefined;

    const result = mapGammaMarketToMarket(raw);
    expect(result).not.toBeNull();

    expect(result?.gameId).toBeNull();
    expect(result?.sportsMarketType).toBeNull();
  });

  test("returns null when outcomePrices is undefined", () => {
    const raw = makeGammaMarket();
    (raw as Record<string, unknown>).outcomePrices = undefined;

    const result = mapGammaMarketToMarket(raw);
    expect(result).toBeNull();
  });

  test("maps team-based outcomes for moneyline markets", () => {
    const result = mapGammaMarketToMarket(
      makeGammaMarket({
        outcomes: '["Arsenal FC", "Brighton FC"]',
        outcomePrices: '["0.65", "0.35"]',
      }),
    );
    expect(result).not.toBeNull();

    expect(result?.outcomes).toEqual(["Arsenal FC", "Brighton FC"]);
    expect(result?.outcomePrices).toEqual(["0.65", "0.35"]);
  });
});

describe("mapGammaEventToEvent", () => {
  test("maps event fields and nested markets", () => {
    const result = mapGammaEventToEvent(makeGammaEvent());

    expect(result.id).toBe("218306");
    expect(result.slug).toBe("epl-tot-cry-2026-03-05");
    expect(result.title).toBe("Tottenham Hotspur FC vs. Crystal Palace FC");
    expect(result.active).toBe(true);
    expect(result.closed).toBe(false);
    expect(result.endDate).toBe("2026-03-06T00:00:00Z");
    expect(result.markets).toHaveLength(1);
    expect(result.markets[0]?.id).toBe("1400768");
    expect(result.markets[0]?.polymarketUrl).toBe(
      "https://polymarket.com/sports/premier-league-2025/epl-tot-cry-2026-03-05",
    );
  });

  test("prefers startTime over startDate", () => {
    const result = mapGammaEventToEvent(makeGammaEvent());

    expect(result.startDate).toBe("2026-03-05T20:00:00Z");
  });

  test("falls back to startDate when startTime is empty", () => {
    const result = mapGammaEventToEvent(makeGammaEvent({ startTime: "" }));

    expect(result.startDate).toBe("2026-02-14T05:11:37Z");
  });

  test("maps multiple nested markets", () => {
    const result = mapGammaEventToEvent(
      makeGammaEvent({
        markets: [
          makeGammaMarket({ id: "1", question: "Will Team A win?" }),
          makeGammaMarket({ id: "2", question: "Will Team B win?" }),
          makeGammaMarket({ id: "3", question: "Will it draw?" }),
        ],
      }),
    );

    expect(result.markets).toHaveLength(3);
    expect(result.markets[0]?.question).toBe("Will Team A win?");
    expect(result.markets[1]?.question).toBe("Will Team B win?");
    expect(result.markets[2]?.question).toBe("Will it draw?");
  });

  test("propagates event-level gameId to markets lacking their own", () => {
    const result = mapGammaEventToEvent(
      makeGammaEvent({
        gameId: 90091278,
        markets: [makeGammaMarket({ gameId: null })],
      }),
    );

    expect(result.markets[0]?.gameId).toBe("90091278");
  });

  test("market-level gameId takes precedence over event-level", () => {
    const result = mapGammaEventToEvent(
      makeGammaEvent({
        gameId: 90091278,
        markets: [makeGammaMarket({ gameId: "12345" })],
      }),
    );

    expect(result.markets[0]?.gameId).toBe("12345");
  });

  test("handles null event-level gameId", () => {
    const result = mapGammaEventToEvent(
      makeGammaEvent({
        gameId: null,
        markets: [makeGammaMarket({ gameId: null })],
      }),
    );

    expect(result.markets[0]?.gameId).toBeNull();
  });
});
