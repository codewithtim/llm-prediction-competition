import { describe, expect, test } from "bun:test";
import type { Fixture } from "../../../src/domain/models/fixture.ts";
import type { Event } from "../../../src/domain/models/market.ts";
import { createDiscoveryCache } from "../../../src/orchestrator/discovery-cache.ts";

function makeEvent(): Event {
  return {
    id: "event-1",
    slug: "team-a-vs-team-b",
    title: "Team A vs Team B",
    startDate: "2026-03-05T20:00:00Z",
    endDate: "2026-03-06T00:00:00Z",
    active: true,
    closed: false,
    markets: [],
  };
}

function makeFixture(): Fixture {
  return {
    id: 100,
    league: { id: 39, name: "Premier League", country: "England", season: 2025 },
    homeTeam: { id: 10, name: "Team A", logo: "" },
    awayTeam: { id: 20, name: "Team B", logo: "" },
    date: "2026-03-05T20:00:00Z",
    venue: "Stadium",
    status: "scheduled",
  };
}

describe("createDiscoveryCache", () => {
  test("returns null when cache is empty", () => {
    const cache = createDiscoveryCache(60_000);
    expect(cache.get()).toBeNull();
  });

  test("returns cached data within TTL", () => {
    const cache = createDiscoveryCache(60_000);
    const events = [makeEvent()];
    const fixtures = [makeFixture()];

    cache.set(events, fixtures);
    const result = cache.get();

    expect(result).not.toBeNull();
    expect(result?.events).toEqual(events);
    expect(result?.fixtures).toEqual(fixtures);
  });

  test("returns null after TTL expires", () => {
    const cache = createDiscoveryCache(-1); // negative TTL — always expired
    cache.set([makeEvent()], [makeFixture()]);

    expect(cache.get()).toBeNull();
  });

  test("clear resets the cache", () => {
    const cache = createDiscoveryCache(60_000);
    cache.set([makeEvent()], [makeFixture()]);

    expect(cache.get()).not.toBeNull();
    cache.clear();
    expect(cache.get()).toBeNull();
  });

  test("set overwrites previous data", () => {
    const cache = createDiscoveryCache(60_000);
    const event1 = makeEvent();
    const event2 = { ...makeEvent(), id: "event-2" };

    cache.set([event1], [makeFixture()]);
    cache.set([event2], []);

    const result = cache.get();
    expect(result).not.toBeNull();
    expect(result?.events).toEqual([event2]);
    expect(result?.fixtures).toEqual([]);
  });
});
