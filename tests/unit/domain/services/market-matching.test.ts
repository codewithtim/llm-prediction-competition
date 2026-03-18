import { describe, expect, test } from "bun:test";
import type { Fixture } from "../../../../src/domain/models/fixture.ts";
import type { Event, Market } from "../../../../src/domain/models/market.ts";
import { matchEventsToFixtures } from "../../../../src/domain/services/market-matching.ts";

function makeMarket(overrides: Partial<Market> = {}): Market {
  return {
    id: "market-1",
    conditionId: "0xabc",
    slug: "team-a-win",
    question: "Will Team A win?",
    outcomes: ["Yes", "No"],
    outcomePrices: ["0.6", "0.4"],
    tokenIds: ["tok1", "tok2"],
    active: true,
    closed: false,
    acceptingOrders: true,
    liquidity: 1000,
    volume: 5000,
    gameId: "100",
    sportsMarketType: "moneyline",
    line: null,
    polymarketUrl: null,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "event-1",
    slug: "team-a-vs-team-b",
    title: "Team A vs Team B",
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
    id: 100,
    league: {
      id: 39,
      name: "Premier League",
      country: "England",
      season: 2024,
    },
    homeTeam: { id: 10, name: "Team A", logo: "" },
    awayTeam: { id: 20, name: "Team B", logo: "" },
    date: "2026-03-05T20:00:00Z",
    venue: "Stadium",
    status: "scheduled",
    ...overrides,
  };
}

describe("matchEventsToFixtures", () => {
  test("matches event to fixture by team names and date", () => {
    const events = [makeEvent({ title: "Arsenal vs Chelsea" })];
    const fixtures = [
      makeFixture({
        homeTeam: { id: 42, name: "Arsenal", logo: "" },
        awayTeam: { id: 49, name: "Chelsea", logo: "" },
      }),
    ];

    const result = matchEventsToFixtures(events, fixtures);

    expect(result.matched).toHaveLength(1);
    expect(result.unmatchedEvents).toHaveLength(0);
    expect(result.unmatchedFixtures).toHaveLength(0);
  });

  test("matches with FC suffix differences", () => {
    const events = [makeEvent({ title: "Arsenal FC vs Chelsea FC" })];
    const fixtures = [
      makeFixture({
        homeTeam: { id: 42, name: "Arsenal", logo: "" },
        awayTeam: { id: 49, name: "Chelsea", logo: "" },
      }),
    ];

    const result = matchEventsToFixtures(events, fixtures);

    expect(result.matched).toHaveLength(1);
  });

  test("reports unmatched events", () => {
    const events = [makeEvent({ title: "Arsenal vs Chelsea" })];
    const fixtures = [
      makeFixture({
        homeTeam: { id: 10, name: "Liverpool", logo: "" },
        awayTeam: { id: 20, name: "Everton", logo: "" },
      }),
    ];

    const result = matchEventsToFixtures(events, fixtures);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedEvents).toHaveLength(1);
    expect(result.unmatchedFixtures).toHaveLength(1);
  });

  test("does not match events with different dates beyond 24h", () => {
    const events = [
      makeEvent({
        title: "Arsenal vs Chelsea",
        startDate: "2026-03-05T20:00:00Z",
      }),
    ];
    const fixtures = [
      makeFixture({
        homeTeam: { id: 42, name: "Arsenal", logo: "" },
        awayTeam: { id: 49, name: "Chelsea", logo: "" },
        date: "2026-03-08T20:00:00Z", // 3 days later
      }),
    ];

    const result = matchEventsToFixtures(events, fixtures);

    expect(result.matched).toHaveLength(0);
  });
});

describe("matchEventsToFixtures — Champions League", () => {
  test("matches CL event with Real Madrid CF vs Manchester City FC", () => {
    const events = [
      makeEvent({
        title: "Real Madrid CF vs Manchester City FC",
        startDate: "2026-03-05T20:00:00Z",
      }),
    ];
    const fixtures = [
      makeFixture({
        id: 500,
        league: { id: 2, name: "Champions League", country: "World", season: 2024 },
        homeTeam: { id: 541, name: "Real Madrid", logo: "" },
        awayTeam: { id: 50, name: "Manchester City", logo: "" },
        date: "2026-03-05T20:00:00Z",
      }),
    ];

    const result = matchEventsToFixtures(events, fixtures);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.fixture.id).toBe(500);
  });

  test("matches CL event with FC Barcelona vs Bayern Munich", () => {
    const events = [
      makeEvent({
        title: "FC Barcelona vs FC Bayern München",
        startDate: "2026-03-05T20:00:00Z",
      }),
    ];
    const fixtures = [
      makeFixture({
        homeTeam: { id: 529, name: "Barcelona", logo: "" },
        awayTeam: { id: 157, name: "Bayern Munich", logo: "" },
        date: "2026-03-05T20:00:00Z",
      }),
    ];

    const result = matchEventsToFixtures(events, fixtures);

    expect(result.matched).toHaveLength(1);
  });

  test("matches CL event with PSG vs Borussia Dortmund", () => {
    const events = [
      makeEvent({
        title: "Paris Saint-Germain FC vs Borussia Dortmund",
        startDate: "2026-03-05T20:00:00Z",
      }),
    ];
    const fixtures = [
      makeFixture({
        homeTeam: { id: 85, name: "Paris Saint Germain", logo: "" },
        awayTeam: { id: 165, name: "Borussia Dortmund", logo: "" },
        date: "2026-03-05T20:00:00Z",
      }),
    ];

    const result = matchEventsToFixtures(events, fixtures);

    expect(result.matched).toHaveLength(1);
  });

  test("matches CL event with Inter vs Atletico Madrid", () => {
    const events = [
      makeEvent({
        title: "Inter vs Club Atlético de Madrid",
        startDate: "2026-03-05T20:00:00Z",
      }),
    ];
    const fixtures = [
      makeFixture({
        homeTeam: { id: 505, name: "Inter", logo: "" },
        awayTeam: { id: 530, name: "Atletico Madrid", logo: "" },
        date: "2026-03-05T20:00:00Z",
      }),
    ];

    const result = matchEventsToFixtures(events, fixtures);

    expect(result.matched).toHaveLength(1);
  });

  test("matches CL event with Bayer 04 Leverkusen", () => {
    const events = [
      makeEvent({
        title: "Bayer 04 Leverkusen vs Liverpool FC",
        startDate: "2026-03-05T20:00:00Z",
      }),
    ];
    const fixtures = [
      makeFixture({
        homeTeam: { id: 168, name: "Bayer Leverkusen", logo: "" },
        awayTeam: { id: 40, name: "Liverpool", logo: "" },
        date: "2026-03-05T20:00:00Z",
      }),
    ];

    const result = matchEventsToFixtures(events, fixtures);

    expect(result.matched).toHaveLength(1);
  });

  test("handles mixed PL and CL events matching to correct fixtures", () => {
    const events = [
      makeEvent({
        id: "pl-1",
        title: "Arsenal vs Chelsea",
        startDate: "2026-03-05T20:00:00Z",
      }),
      makeEvent({
        id: "ucl-1",
        title: "Real Madrid CF vs Manchester City FC",
        startDate: "2026-03-05T20:00:00Z",
        markets: [makeMarket({ id: "ucl-market-1" })],
      }),
    ];
    const fixtures = [
      makeFixture({
        id: 100,
        homeTeam: { id: 42, name: "Arsenal", logo: "" },
        awayTeam: { id: 49, name: "Chelsea", logo: "" },
        date: "2026-03-05T20:00:00Z",
      }),
      makeFixture({
        id: 500,
        league: { id: 2, name: "Champions League", country: "World", season: 2024 },
        homeTeam: { id: 541, name: "Real Madrid", logo: "" },
        awayTeam: { id: 50, name: "Manchester City", logo: "" },
        date: "2026-03-05T20:00:00Z",
      }),
    ];

    const result = matchEventsToFixtures(events, fixtures);

    expect(result.matched).toHaveLength(2);
    expect(result.unmatchedEvents).toHaveLength(0);
    expect(result.unmatchedFixtures).toHaveLength(0);
  });

  test("event with ' - More Markets' suffix still matches", () => {
    const events = [
      makeEvent({
        title: "Real Madrid CF vs Manchester City FC - More Markets",
        startDate: "2026-03-05T20:00:00Z",
      }),
    ];
    const fixtures = [
      makeFixture({
        homeTeam: { id: 541, name: "Real Madrid", logo: "" },
        awayTeam: { id: 50, name: "Manchester City", logo: "" },
        date: "2026-03-05T20:00:00Z",
      }),
    ];

    const result = matchEventsToFixtures(events, fixtures);

    expect(result.matched).toHaveLength(1);
  });
});
