import { describe, expect, test } from "bun:test";
import type { Fixture } from "../../../../src/domain/models/fixture.ts";
import type { Event, Market } from "../../../../src/domain/models/market.ts";
import { matchEventsToFixtures } from "../../../../src/domain/services/market-matching.ts";

function makeMarket(overrides: Partial<Market> = {}): Market {
  return {
    id: "market-1",
    conditionId: "0xabc",
    slug: "will-arsenal-win",
    question: "Will Arsenal FC win?",
    outcomes: ["Yes", "No"],
    outcomePrices: ["0.65", "0.35"],
    tokenIds: ["tok-yes", "tok-no"],
    active: true,
    closed: false,
    acceptingOrders: true,
    liquidity: 5000,
    volume: 12000,
    gameId: null,
    sportsMarketType: "moneyline",
    line: null,
    polymarketUrl: null,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "event-1",
    slug: "arsenal-vs-brighton",
    title: "Arsenal FC vs. Brighton FC",
    startDate: "2026-03-05T20:00:00Z",
    endDate: "2026-03-06T00:00:00Z",
    active: true,
    closed: false,
    markets: [makeMarket()],
    ...overrides,
  };
}

function makeFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    id: 12345,
    league: {
      id: 39,
      name: "Premier League",
      country: "England",
      season: 2025,
    },
    homeTeam: { id: 42, name: "Arsenal", logo: null },
    awayTeam: { id: 51, name: "Brighton", logo: null },
    date: "2026-03-05T20:00:00Z",
    venue: "Emirates Stadium",
    status: "scheduled",
    ...overrides,
  };
}

describe("gameId matching", () => {
  test("matches market to fixture by gameId", () => {
    const market = makeMarket({ gameId: "12345" });
    const event = makeEvent({ markets: [market] });
    const fixture = makeFixture({ id: 12345 });

    const result = matchEventsToFixtures([event], [fixture]);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.fixture.id).toBe(12345);
    expect(result.matched[0]?.markets).toHaveLength(1);
    expect(result.matched[0]?.markets[0]?.market.id).toBe("market-1");
  });

  test("matches multiple markets from same event to same fixture", () => {
    const market1 = makeMarket({ id: "m1", gameId: "12345" });
    const market2 = makeMarket({
      id: "m2",
      gameId: "12345",
      sportsMarketType: "spreads",
    });
    const event = makeEvent({ markets: [market1, market2] });
    const fixture = makeFixture({ id: 12345 });

    const result = matchEventsToFixtures([event], [fixture]);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.markets).toHaveLength(2);
  });

  test("non-matching gameId falls through to fallback", () => {
    const market = makeMarket({ gameId: "99999" });
    const event = makeEvent({
      title: "Arsenal FC vs. Brighton FC",
      startDate: "2026-03-05T20:00:00Z",
      markets: [market],
    });
    const fixture = makeFixture({ id: 12345 });

    const result = matchEventsToFixtures([event], [fixture]);

    // Should match via team name + date fallback
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.fixture.id).toBe(12345);
  });

  test("non-numeric gameId handled gracefully", () => {
    const market = makeMarket({ gameId: "not-a-number" });
    const event = makeEvent({
      title: "Arsenal FC vs. Brighton FC",
      startDate: "2026-03-05T20:00:00Z",
      markets: [market],
    });
    const fixture = makeFixture({ id: 12345 });

    const result = matchEventsToFixtures([event], [fixture]);

    // Falls through to team name + date fallback
    expect(result.matched).toHaveLength(1);
  });
});

describe("team name + date fallback matching", () => {
  test("matches when teams and date align and gameId is null", () => {
    const event = makeEvent({
      title: "Arsenal FC vs. Brighton FC",
      startDate: "2026-03-05T20:00:00Z",
      markets: [makeMarket({ gameId: null })],
    });
    const fixture = makeFixture();

    const result = matchEventsToFixtures([event], [fixture]);

    expect(result.matched).toHaveLength(1);
    expect(result.unmatchedEvents).toHaveLength(0);
  });

  test("fails when teams match but dates differ", () => {
    const event = makeEvent({
      title: "Arsenal FC vs. Brighton FC",
      startDate: "2026-03-10T20:00:00Z",
      markets: [makeMarket({ gameId: null })],
    });
    const fixture = makeFixture();

    const result = matchEventsToFixtures([event], [fixture]);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedEvents).toHaveLength(1);
  });

  test("fails when dates match but teams differ", () => {
    const event = makeEvent({
      title: "Chelsea FC vs. Liverpool FC",
      startDate: "2026-03-05T20:00:00Z",
      markets: [makeMarket({ gameId: null })],
    });
    const fixture = makeFixture();

    const result = matchEventsToFixtures([event], [fixture]);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedEvents).toHaveLength(1);
  });

  test("alias-required names matched correctly", () => {
    const event = makeEvent({
      title: "Tottenham Hotspur FC vs. Crystal Palace FC",
      startDate: "2026-03-05T20:00:00Z",
      markets: [makeMarket({ gameId: null })],
    });
    const fixture = makeFixture({
      homeTeam: { id: 47, name: "Tottenham", logo: null },
      awayTeam: { id: 52, name: "Crystal Palace", logo: null },
    });

    const result = matchEventsToFixtures([event], [fixture]);

    expect(result.matched).toHaveLength(1);
  });

  test("matches Manchester City FC vs. Nottingham Forest FC event to fixture", () => {
    const event = makeEvent({
      title: "Manchester City FC vs. Nottingham Forest FC",
      startDate: "2026-03-04T19:30:00Z",
      markets: [
        makeMarket({ id: "1396101", gameId: null, slug: "epl-mac-not-2026-03-04-mac", question: "Will Manchester City FC win on 2026-03-04?" }),
        makeMarket({ id: "1396102", gameId: null, slug: "epl-mac-not-2026-03-04-draw", question: "Will Manchester City FC vs. Nottingham Forest FC end in a draw?" }),
        makeMarket({ id: "1396103", gameId: null, slug: "epl-mac-not-2026-03-04-not", question: "Will Nottingham Forest FC win on 2026-03-04?" }),
      ],
    });
    const fixture = makeFixture({
      homeTeam: { id: 50, name: "Manchester City", logo: null },
      awayTeam: { id: 65, name: "Nottingham Forest", logo: null },
      date: "2026-03-04T19:30:00Z",
    });

    const result = matchEventsToFixtures([event], [fixture]);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.markets).toHaveLength(3);
  });

  test("matches Nottingham Forest FC vs. Fulham FC event to fixture", () => {
    const event = makeEvent({
      title: "Nottingham Forest FC vs. Fulham FC",
      startDate: "2026-03-15T15:00:00Z",
      markets: [
        makeMarket({ id: "1480740", gameId: null, slug: "epl-not-ful-2026-03-15-not", question: "Will Nottingham Forest FC win on 2026-03-15?" }),
        makeMarket({ id: "1480742", gameId: null, slug: "epl-not-ful-2026-03-15-draw", question: "Will Nottingham Forest FC vs. Fulham FC end in a draw?" }),
        makeMarket({ id: "1480744", gameId: null, slug: "epl-not-ful-2026-03-15-ful", question: "Will Fulham FC win on 2026-03-15?" }),
      ],
    });
    const fixture = makeFixture({
      homeTeam: { id: 65, name: "Nottingham Forest", logo: null },
      awayTeam: { id: 36, name: "Fulham", logo: null },
      date: "2026-03-15T15:00:00Z",
    });

    const result = matchEventsToFixtures([event], [fixture]);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.markets).toHaveLength(3);
  });

  test("matches Brentford FC vs. Wolverhampton Wanderers FC event to fixture (API-Football uses Wolves)", () => {
    const event = makeEvent({
      title: "Brentford FC vs. Wolverhampton Wanderers FC",
      startDate: "2026-03-16T14:00:00Z",
      markets: [
        makeMarket({ id: "1488887", gameId: null, slug: "epl-bre-wol-2026-03-16-bre", question: "Will Brentford FC win on 2026-03-16?" }),
        makeMarket({ id: "1488892", gameId: null, slug: "epl-bre-wol-2026-03-16-draw", question: "Will Brentford FC vs. Wolverhampton Wanderers FC end in a draw?" }),
        makeMarket({ id: "1488895", gameId: null, slug: "epl-bre-wol-2026-03-16-wol", question: "Will Wolverhampton Wanderers FC win on 2026-03-16?" }),
      ],
    });
    const fixture = makeFixture({
      homeTeam: { id: 55, name: "Brentford", logo: null },
      awayTeam: { id: 76, name: "Wolves", logo: null },
      date: "2026-03-16T14:00:00Z",
    });

    const result = matchEventsToFixtures([event], [fixture]);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.markets).toHaveLength(3);
  });
});

describe("two-events-per-match grouping", () => {
  test("main event + More Markets event grouped under one MatchedFixture", () => {
    const mainMarket = makeMarket({ id: "m-main", gameId: "12345" });
    const moreMarket = makeMarket({
      id: "m-more",
      gameId: "12345",
      sportsMarketType: "totals",
    });

    const mainEvent = makeEvent({
      id: "evt-main",
      title: "Arsenal FC vs. Brighton FC",
      markets: [mainMarket],
    });
    const moreEvent = makeEvent({
      id: "evt-more",
      title: "Arsenal FC vs. Brighton FC - More Markets",
      markets: [moreMarket],
    });

    const fixture = makeFixture({ id: 12345 });

    const result = matchEventsToFixtures([mainEvent, moreEvent], [fixture]);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.markets).toHaveLength(2);
    expect(result.matched[0]?.markets.map((m) => m.market.id)).toContain("m-main");
    expect(result.matched[0]?.markets.map((m) => m.market.id)).toContain("m-more");
  });

  test("no duplicate market entries when same market appears in multiple events", () => {
    const sharedMarket = makeMarket({ id: "shared", gameId: "12345" });
    const event1 = makeEvent({
      id: "evt-1",
      markets: [sharedMarket],
    });
    const event2 = makeEvent({
      id: "evt-2",
      markets: [sharedMarket],
    });
    const fixture = makeFixture({ id: 12345 });

    const result = matchEventsToFixtures([event1, event2], [fixture]);

    expect(result.matched).toHaveLength(1);
    // Same market ID should only appear once
    const marketIds = result.matched[0]?.markets.map((m) => m.market.id);
    expect(marketIds).toHaveLength(1);
    expect(marketIds?.[0]).toBe("shared");
  });
});

describe("unmatched tracking", () => {
  test("events with no matching fixture in unmatchedEvents", () => {
    const event = makeEvent({
      title: "Chelsea FC vs. Liverpool FC",
      markets: [makeMarket({ gameId: null })],
    });
    const fixture = makeFixture();

    const result = matchEventsToFixtures([event], [fixture]);

    expect(result.unmatchedEvents).toHaveLength(1);
    expect(result.unmatchedEvents[0]?.id).toBe("event-1");
  });

  test("fixtures with no matching event in unmatchedFixtures", () => {
    const event = makeEvent({
      title: "Chelsea FC vs. Liverpool FC",
      markets: [makeMarket({ gameId: null })],
    });
    const fixture = makeFixture();

    const result = matchEventsToFixtures([event], [fixture]);

    expect(result.unmatchedFixtures).toHaveLength(1);
    expect(result.unmatchedFixtures[0]?.id).toBe(12345);
  });
});

describe("edge cases", () => {
  test("empty events array", () => {
    const result = matchEventsToFixtures([], [makeFixture()]);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedEvents).toHaveLength(0);
    expect(result.unmatchedFixtures).toHaveLength(1);
  });

  test("empty fixtures array", () => {
    const result = matchEventsToFixtures([makeEvent()], []);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedEvents).toHaveLength(1);
    expect(result.unmatchedFixtures).toHaveLength(0);
  });

  test("both arrays empty", () => {
    const result = matchEventsToFixtures([], []);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedEvents).toHaveLength(0);
    expect(result.unmatchedFixtures).toHaveLength(0);
  });

  test("gameId match preferred over name match", () => {
    // Two fixtures: one matches by gameId, the other matches by team name + date
    const market = makeMarket({ gameId: "99999" });
    const event = makeEvent({
      title: "Arsenal FC vs. Brighton FC",
      startDate: "2026-03-05T20:00:00Z",
      markets: [market],
    });
    const fixtureByName = makeFixture({ id: 12345 });
    const fixtureById = makeFixture({
      id: 99999,
      homeTeam: { id: 100, name: "Other Team", logo: null },
      awayTeam: { id: 101, name: "Another Team", logo: null },
    });

    const result = matchEventsToFixtures([event], [fixtureByName, fixtureById]);

    expect(result.matched).toHaveLength(1);
    // Should match by gameId, not by team name
    expect(result.matched[0]?.fixture.id).toBe(99999);
  });
});
