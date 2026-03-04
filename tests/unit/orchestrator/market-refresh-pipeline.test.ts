import { describe, expect, mock, test } from "bun:test";
import type { Market } from "../../../src/domain/models/market.ts";
import {
  createMarketRefreshPipeline,
  type MarketRefreshPipelineDeps,
} from "../../../src/orchestrator/market-refresh-pipeline.ts";

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

function makeEvent(id = "event-1", markets: Market[] = [makeMarket()]) {
  return {
    id,
    slug: "team-a-vs-team-b",
    title: "Team A vs Team B",
    startDate: "2026-03-05T20:00:00Z",
    endDate: "2026-03-06T00:00:00Z",
    active: true,
    closed: false,
    markets,
  };
}

function makeDbFixture(id = 100) {
  return {
    id,
    leagueId: 39,
    leagueName: "Premier League",
    leagueCountry: "England",
    leagueSeason: 2025,
    homeTeamId: 1,
    homeTeamName: "Team A",
    homeTeamLogo: null,
    awayTeamId: 2,
    awayTeamName: "Team B",
    awayTeamLogo: null,
    date: "2026-03-05T20:00:00Z",
    venue: "Stadium",
    status: "scheduled" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildDeps(overrides: Partial<MarketRefreshPipelineDeps> = {}): MarketRefreshPipelineDeps {
  return {
    discovery: {
      discoverFootballMarkets: mock(() => Promise.resolve([])),
    } as any,
    marketsRepo: {
      bulkUpsert: mock(() => Promise.resolve()),
    } as any,
    fixturesRepo: {
      findScheduledUpcoming: mock(() => Promise.resolve([])),
    } as any,
    ...overrides,
  };
}

describe("createMarketRefreshPipeline", () => {
  test("fetches events and upserts markets", async () => {
    const deps = buildDeps({
      discovery: {
        discoverFootballMarkets: mock(() => Promise.resolve([makeEvent()])),
      } as any,
      fixturesRepo: {
        findScheduledUpcoming: mock(() => Promise.resolve([makeDbFixture()])),
      } as any,
    });

    const pipeline = createMarketRefreshPipeline(deps);
    const result = await pipeline.run();

    expect(result.eventsDiscovered).toBe(1);
    expect(result.marketsUpserted).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(deps.marketsRepo.bulkUpsert).toHaveBeenCalledTimes(1);
  });

  test("matches markets to DB fixtures by gameId", async () => {
    const market = makeMarket({ id: "m1", gameId: "100" });
    const deps = buildDeps({
      discovery: {
        discoverFootballMarkets: mock(() => Promise.resolve([makeEvent("e1", [market])])),
      } as any,
      fixturesRepo: {
        findScheduledUpcoming: mock(() => Promise.resolve([makeDbFixture(100)])),
      } as any,
    });

    const pipeline = createMarketRefreshPipeline(deps);
    const result = await pipeline.run();

    expect(result.marketsUpserted).toBe(1);
    const bulkUpsertCall = (deps.marketsRepo.bulkUpsert as ReturnType<typeof mock>).mock.calls[0];
    const rows = bulkUpsertCall?.[0] as { fixtureId: number | null }[];
    expect(rows?.[0]?.fixtureId).toBe(100);
  });

  test("handles empty events gracefully", async () => {
    const deps = buildDeps();
    const pipeline = createMarketRefreshPipeline(deps);
    const result = await pipeline.run();

    expect(result.eventsDiscovered).toBe(0);
    expect(result.marketsUpserted).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  test("handles Gamma fetch failure gracefully", async () => {
    const deps = buildDeps({
      discovery: {
        discoverFootballMarkets: mock(() => Promise.reject(new Error("Gamma API down"))),
      } as any,
    });

    const pipeline = createMarketRefreshPipeline(deps);
    const result = await pipeline.run();

    expect(result.eventsDiscovered).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Gamma API down");
    expect(deps.marketsRepo.bulkUpsert).not.toHaveBeenCalled();
  });

  test("upserts markets with null fixtureId when no fixtures in DB", async () => {
    const deps = buildDeps({
      discovery: {
        discoverFootballMarkets: mock(() => Promise.resolve([makeEvent()])),
      } as any,
      fixturesRepo: {
        findScheduledUpcoming: mock(() => Promise.resolve([])),
      } as any,
    });

    const pipeline = createMarketRefreshPipeline(deps);
    const result = await pipeline.run();

    expect(result.marketsUpserted).toBe(1);
    const bulkUpsertCall = (deps.marketsRepo.bulkUpsert as ReturnType<typeof mock>).mock.calls[0];
    const rows = bulkUpsertCall?.[0] as { fixtureId: number | null }[];
    expect(rows?.[0]?.fixtureId).toBeNull();
  });
});
