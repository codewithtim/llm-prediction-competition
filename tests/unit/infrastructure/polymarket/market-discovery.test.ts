import { describe, expect, test } from "bun:test";
import type { GammaClient } from "../../../../src/infrastructure/polymarket/gamma-client.ts";
import {
  createMarketDiscovery,
  extractTagIds,
  isFootballSport,
} from "../../../../src/infrastructure/polymarket/market-discovery.ts";
import type {
  GammaEvent,
  GammaMarket,
  GammaSport,
} from "../../../../src/infrastructure/polymarket/types.ts";

function makeSport(overrides: Partial<GammaSport> = {}): GammaSport {
  return {
    id: 1,
    sport: "epl",
    image: "https://example.com/epl.jpg",
    resolution: "https://www.premierleague.com/",
    ordering: "home",
    tags: "1,82,306",
    series: "10188",
    createdAt: "2025-11-05T19:27:45Z",
    ...overrides,
  };
}

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
    markets: [makeGammaMarket()],
    ...overrides,
  };
}

describe("isFootballSport", () => {
  test("identifies EPL as football", () => {
    expect(isFootballSport(makeSport({ sport: "epl" }))).toBe(true);
  });

  test("identifies La Liga as football", () => {
    expect(isFootballSport(makeSport({ sport: "la-liga" }))).toBe(true);
  });

  test("identifies Serie A as football", () => {
    expect(isFootballSport(makeSport({ sport: "serie-a" }))).toBe(true);
  });

  test("identifies Bundesliga as football", () => {
    expect(isFootballSport(makeSport({ sport: "bundesliga" }))).toBe(true);
  });

  test("identifies soccer-ucl as football", () => {
    expect(isFootballSport(makeSport({ sport: "soccer-ucl" }))).toBe(true);
  });

  test("identifies soccer as football", () => {
    expect(isFootballSport(makeSport({ sport: "soccer" }))).toBe(true);
  });

  test("rejects NBA as not football", () => {
    expect(isFootballSport(makeSport({ sport: "nba" }))).toBe(false);
  });

  test("rejects NHL as not football", () => {
    expect(isFootballSport(makeSport({ sport: "nhl" }))).toBe(false);
  });

  test("rejects cricket as not football", () => {
    expect(isFootballSport(makeSport({ sport: "ipl" }))).toBe(false);
  });
});

describe("extractTagIds", () => {
  test("parses comma-separated tag strings", () => {
    const sports = [makeSport({ tags: "1,82,306" })];
    const result = extractTagIds(sports);

    expect(result).toContain(1);
    expect(result).toContain(82);
    expect(result).toContain(306);
  });

  test("deduplicates across multiple sports", () => {
    const sports = [makeSport({ tags: "1,82,306" }), makeSport({ tags: "82,100639,100350" })];
    const result = extractTagIds(sports);

    expect(result.filter((t) => t === 82)).toHaveLength(1);
  });

  test("handles empty tags gracefully", () => {
    const sports = [makeSport({ tags: "" })];
    const result = extractTagIds(sports);

    expect(result).toEqual([]);
  });
});

describe("createMarketDiscovery", () => {
  function mockGammaClient(overrides: Partial<GammaClient> = {}): GammaClient {
    return {
      getSports: async () => [],
      getEvents: async () => [],
      ...overrides,
    };
  }

  test("discoverFootballLeagues filters football sports from all sports", async () => {
    const gamma = mockGammaClient({
      getSports: async () => [
        makeSport({ sport: "epl" }),
        makeSport({ sport: "nba" }),
        makeSport({ sport: "la-liga" }),
        makeSport({ sport: "nhl" }),
        makeSport({ sport: "soccer-ucl" }),
      ],
    });

    const discovery = createMarketDiscovery(gamma);
    const leagues = await discovery.discoverFootballLeagues();

    expect(leagues).toHaveLength(3);
    expect(leagues.map((l) => l.sport)).toEqual(["epl", "la-liga", "soccer-ucl"]);
  });

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

    const discovery = createMarketDiscovery(gamma);
    const events = await discovery.fetchActiveEvents(82, 2);

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

    const discovery = createMarketDiscovery(gamma);
    const events = await discovery.fetchActiveEvents(82, 50);

    expect(events).toHaveLength(1);
    expect(callCount).toBe(1);
  });

  test("discoverFootballMarkets deduplicates events across tags", async () => {
    const gamma = mockGammaClient({
      getSports: async () => [
        makeSport({ sport: "epl", tags: "82" }),
        makeSport({ sport: "soccer", tags: "100350" }),
      ],
      getEvents: async (params = {}) => {
        if (params.tag_id === 82) {
          return [makeGammaEvent({ id: "1" }), makeGammaEvent({ id: "2" })];
        }
        if (params.tag_id === 100350) {
          return [makeGammaEvent({ id: "2" }), makeGammaEvent({ id: "3" })];
        }
        return [];
      },
    });

    const discovery = createMarketDiscovery(gamma);
    const events = await discovery.discoverFootballMarkets();

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.id).sort()).toEqual(["1", "2", "3"]);
  });
});
