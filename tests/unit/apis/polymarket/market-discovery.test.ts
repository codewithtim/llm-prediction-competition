import { describe, expect, test } from "bun:test";
import type { GammaClient } from "../../../../src/apis/polymarket/gamma-client.ts";
import {
  collectSeriesSlugs,
  createMarketDiscovery,
  filterBySeriesSlug,
  filterToMoneylineMarkets,
  type MarketDiscoveryConfig,
} from "../../../../src/apis/polymarket/market-discovery.ts";
import type { GammaEvent, GammaMarket } from "../../../../src/apis/polymarket/types.ts";

function makeGammaMarket(overrides: Partial<GammaMarket> = {}): GammaMarket {
  return {
    id: "100",
    question: "Will Team A win?",
    conditionId: "0xabc",
    slug: "team-a-win",
    outcomes: '["Yes", "No"]',
    outcomePrices: '["0.5", "0.5"]',
    clobTokenIds: '["tok1", "tok2"]',
    active: true,
    closed: false,
    acceptingOrders: true,
    liquidity: "1000",
    liquidityNum: 1000,
    volume: "5000",
    volumeNum: 5000,
    gameId: "12345",
    sportsMarketType: "moneyline",
    bestBid: 0.48,
    bestAsk: 0.52,
    lastTradePrice: 0.5,
    orderPriceMinTickSize: 0.01,
    orderMinSize: 5,
    ...overrides,
  };
}

function makeGammaEvent(overrides: Partial<GammaEvent> = {}): GammaEvent {
  return {
    id: "1000",
    title: "Team A vs Team B",
    slug: "team-a-vs-team-b",
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
    gameId: null,
    markets: [makeGammaMarket()],
    ...overrides,
  };
}

function mockGammaClient(overrides: Partial<GammaClient> = {}): GammaClient {
  return {
    getSports: async () => [],
    getEvents: async () => [],
    getMarketById: async () => null,
    getTags: async () => [],
    ...overrides,
  };
}

const DEFAULT_TEST_CONFIG: MarketDiscoveryConfig = {
  leagues: [{ polymarketSeriesSlug: "premier-league" }],
  soccerTagId: 100350,
  lookAheadDays: 7,
};

describe("collectSeriesSlugs", () => {
  test("collects series slugs from league config", () => {
    const config: MarketDiscoveryConfig = {
      leagues: [
        { polymarketSeriesSlug: "premier-league" },
        { polymarketSeriesSlug: "la-liga" },
      ],
      soccerTagId: 100350,
      lookAheadDays: 7,
    };
    const result = collectSeriesSlugs(config);

    expect(result).toEqual(["premier-league", "la-liga"]);
  });
});

describe("filterBySeriesSlug", () => {
  test("keeps events matching configured series slugs", () => {
    const events = [
      makeGammaEvent({ id: "1", seriesSlug: "premier-league-2025" }),
      makeGammaEvent({ id: "2", seriesSlug: "la-liga-2025" }),
      makeGammaEvent({ id: "3", seriesSlug: "nba-2025" }),
    ];

    const result = filterBySeriesSlug(events, ["premier-league", "la-liga"]);

    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(["1", "2"]);
  });

  test("filters out all events when no slugs match", () => {
    const events = [makeGammaEvent({ seriesSlug: "nba-2025" })];
    const result = filterBySeriesSlug(events, ["premier-league"]);

    expect(result).toHaveLength(0);
  });

  test("skips events with undefined or empty seriesSlug without crashing", () => {
    const events = [
      makeGammaEvent({ id: "1", seriesSlug: undefined as unknown as string }),
      makeGammaEvent({ id: "2", seriesSlug: "" }),
      makeGammaEvent({ id: "3", seriesSlug: "fa-cup" }),
    ];
    const result = filterBySeriesSlug(events, ["fa-cup"]);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("3");
  });
});

describe("filterToMoneylineMarkets", () => {
  test("keeps only moneyline markets", () => {
    const event = makeGammaEvent({
      markets: [
        makeGammaMarket({ id: "1", sportsMarketType: "moneyline" }),
        makeGammaMarket({ id: "2", sportsMarketType: "spreads" }),
        makeGammaMarket({ id: "3", sportsMarketType: "totals" }),
      ],
    });

    const result = filterToMoneylineMarkets(event);

    expect(result.markets).toHaveLength(1);
    expect(result.markets[0]?.id).toBe("1");
  });

  test("returns empty markets when no moneyline markets exist", () => {
    const event = makeGammaEvent({
      markets: [makeGammaMarket({ sportsMarketType: "spreads" })],
    });

    const result = filterToMoneylineMarkets(event);

    expect(result.markets).toHaveLength(0);
  });
});

describe("createMarketDiscovery", () => {
  test("fetchActiveEvents paginates through results", async () => {
    let callCount = 0;
    const gamma = mockGammaClient({
      getEvents: async (params = {}) => {
        callCount++;
        if (params.offset === 0) {
          return [makeGammaEvent({ id: "1" }), makeGammaEvent({ id: "2" })];
        }
        return [];
      },
    });

    const discovery = createMarketDiscovery(gamma, DEFAULT_TEST_CONFIG);
    const events = await discovery.fetchActiveEvents(100350, 2);

    expect(events).toHaveLength(2);
    expect(callCount).toBe(2);
  });

  test("fetchActiveEvents stops when batch is smaller than limit", async () => {
    let callCount = 0;
    const gamma = mockGammaClient({
      getEvents: async () => {
        callCount++;
        return [makeGammaEvent({ id: `${callCount}` })];
      },
    });

    const discovery = createMarketDiscovery(gamma, DEFAULT_TEST_CONFIG);
    const events = await discovery.fetchActiveEvents(100350, 50);

    expect(events).toHaveLength(1);
    expect(callCount).toBe(1);
  });

  test("fetchActiveEvents passes date range params to gamma client", async () => {
    let capturedParams: Record<string, unknown> = {};
    const gamma = mockGammaClient({
      getEvents: async (params = {}) => {
        capturedParams = params as Record<string, unknown>;
        return [];
      },
    });

    const discovery = createMarketDiscovery(gamma, DEFAULT_TEST_CONFIG);
    await discovery.fetchActiveEvents(100350);

    expect(capturedParams.end_date_min).toBeDefined();
    expect(capturedParams.end_date_max).toBeDefined();
    expect(capturedParams.ascending).toBe(true);
    expect(capturedParams.tag_id).toBe(100350);

    const minDate = new Date(capturedParams.end_date_min as string);
    const maxDate = new Date(capturedParams.end_date_max as string);
    const diffDays = (maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24);
    expect(Math.round(diffDays)).toBe(7);
  });

  test("fetchActiveEvents filters by series slug and moneyline only", async () => {
    const gamma = mockGammaClient({
      getEvents: async () => [
        makeGammaEvent({
          id: "1",
          seriesSlug: "premier-league-2025",
          markets: [makeGammaMarket({ sportsMarketType: "moneyline" })],
        }),
        makeGammaEvent({
          id: "2",
          seriesSlug: "nba-2025",
          markets: [makeGammaMarket({ sportsMarketType: "moneyline" })],
        }),
        makeGammaEvent({
          id: "3",
          seriesSlug: "premier-league-2025",
          markets: [makeGammaMarket({ sportsMarketType: "spreads" })],
        }),
      ],
    });

    const discovery = createMarketDiscovery(gamma, DEFAULT_TEST_CONFIG);
    const events = await discovery.fetchActiveEvents(100350);

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe("1");
  });

  test("discoverFootballMarkets uses soccerTagId", async () => {
    let queriedTagId: number | undefined;
    const gamma = mockGammaClient({
      getEvents: async (params = {}) => {
        queriedTagId = params.tag_id;
        return [];
      },
    });

    const config: MarketDiscoveryConfig = {
      leagues: [
        { polymarketSeriesSlug: "premier-league" },
        { polymarketSeriesSlug: "la-liga" },
      ],
      soccerTagId: 100350,
      lookAheadDays: 7,
    };
    const discovery = createMarketDiscovery(gamma, config);
    await discovery.discoverFootballMarkets();

    expect(queriedTagId).toBe(100350);
  });

  test("discoverFootballMarkets does not call getSports", async () => {
    let sportsCallCount = 0;
    const gamma = mockGammaClient({
      getSports: async () => {
        sportsCallCount++;
        return [];
      },
      getEvents: async () => [],
    });

    const discovery = createMarketDiscovery(gamma, DEFAULT_TEST_CONFIG);
    await discovery.discoverFootballMarkets();

    expect(sportsCallCount).toBe(0);
  });

  test("discoverFootballMarkets filters to configured series slugs only", async () => {
    const gamma = mockGammaClient({
      getEvents: async () => [
        makeGammaEvent({ id: "1", seriesSlug: "premier-league-2025" }),
        makeGammaEvent({ id: "2", seriesSlug: "la-liga-2025" }),
        makeGammaEvent({ id: "3", seriesSlug: "nba-2025" }),
      ],
    });

    const config: MarketDiscoveryConfig = {
      leagues: [{ polymarketSeriesSlug: "premier-league" }],
      soccerTagId: 100350,
      lookAheadDays: 7,
    };
    const discovery = createMarketDiscovery(gamma, config);
    const events = await discovery.discoverFootballMarkets();

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe("1");
  });
});
