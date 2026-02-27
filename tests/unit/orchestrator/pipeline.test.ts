import { describe, expect, mock, test } from "bun:test";
import type { CompetitorRegistry } from "../../../src/competitors/registry.ts";
import type { PredictionOutput } from "../../../src/domain/contracts/prediction.ts";
import type { Market } from "../../../src/domain/models/market.ts";
import type { BettingService, PlaceBetResult } from "../../../src/domain/services/betting.ts";
import type { SettlementService } from "../../../src/domain/services/settlement.ts";
import type { MarketDiscovery } from "../../../src/infrastructure/polymarket/market-discovery.ts";
import type { FootballClient } from "../../../src/infrastructure/sports-data/client.ts";
import type {
  ApiFixture,
  ApiResponse,
  ApiStandingsResponse,
} from "../../../src/infrastructure/sports-data/types.ts";
import { DEFAULT_CONFIG } from "../../../src/orchestrator/config.ts";
import { createPipeline, type PipelineDeps } from "../../../src/orchestrator/pipeline.ts";

// ─── Fixtures for tests ──────────────────────────────────────────────

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

function makeApiFixture(id = 100): ApiFixture {
  return {
    fixture: {
      id,
      referee: null,
      timezone: "UTC",
      date: "2026-03-05T20:00:00Z",
      timestamp: 1772323200,
      venue: { id: 1, name: "Stadium", city: "London" },
      status: { long: "Not Started", short: "NS", elapsed: null, extra: null },
    },
    league: {
      id: 39,
      name: "Premier League",
      country: "England",
      logo: "",
      flag: "",
      season: 2024,
      round: "Regular Season - 30",
    },
    teams: {
      home: { id: 10, name: "Team A", logo: "", winner: null },
      away: { id: 20, name: "Team B", logo: "", winner: null },
    },
    goals: { home: null, away: null },
    score: {
      halftime: { home: null, away: null },
      fulltime: { home: null, away: null },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
  };
}

function makeStandingsResponse(homeTeamId = 10, awayTeamId = 20): ApiStandingsResponse[] {
  const makeEntry = (teamId: number, teamName: string) => ({
    rank: 1,
    team: { id: teamId, name: teamName, logo: "" },
    points: 50,
    goalsDiff: 20,
    form: "WWWWW",
    all: { played: 20, win: 15, draw: 3, lose: 2, goals: { for: 40, against: 20 } },
    home: { played: 10, win: 8, draw: 1, lose: 1, goals: { for: 22, against: 8 } },
    away: { played: 10, win: 7, draw: 2, lose: 1, goals: { for: 18, against: 12 } },
  });

  return [
    {
      league: {
        id: 39,
        name: "Premier League",
        country: "England",
        logo: "",
        flag: "",
        season: 2024,
        standings: [[makeEntry(homeTeamId, "Team A"), makeEntry(awayTeamId, "Team B")]],
      },
    },
  ];
}

function makeH2hFixtures(): ApiFixture[] {
  return [
    {
      ...makeApiFixture(999),
      teams: {
        home: { id: 10, name: "Team A", logo: "", winner: true },
        away: { id: 20, name: "Team B", logo: "", winner: false },
      },
      goals: { home: 2, away: 1 },
    },
  ];
}

function makePrediction(overrides: Partial<PredictionOutput> = {}): PredictionOutput {
  return {
    marketId: "market-1",
    side: "YES",
    confidence: 0.7,
    stake: 5,
    reasoning: "Team A is stronger",
    ...overrides,
  };
}

// ─── Mock builders ───────────────────────────────────────────────────

function mockDiscovery(events = [makeEvent()]): MarketDiscovery {
  return {
    discoverFootballMarkets: mock(() => Promise.resolve(events)),
    discoverFootballLeagues: mock(() => Promise.resolve([])),
    fetchActiveEvents: mock(() => Promise.resolve([])),
  };
}

function apiResponse<T>(data: T): ApiResponse<T> {
  return {
    get: "",
    parameters: {},
    errors: [] as [],
    results: 1,
    paging: { current: 1, total: 1 },
    response: data,
  };
}

function mockFootballClient(overrides: Partial<FootballClient> = {}): FootballClient {
  return {
    getFixtures: mock(() => Promise.resolve(apiResponse([makeApiFixture()]))),
    getStandings: mock(() => Promise.resolve(apiResponse(makeStandingsResponse()))),
    getHeadToHead: mock(() => Promise.resolve(apiResponse(makeH2hFixtures()))),
    ...overrides,
  };
}

function mockRegistry(predictions: PredictionOutput[] = [makePrediction()]): CompetitorRegistry {
  return {
    register: mock(() => {}),
    getAll: mock(() => [
      {
        competitorId: "baseline",
        name: "Baseline",
        engine: mock(() => predictions),
      },
    ]),
    get: mock(() => undefined),
  } as unknown as CompetitorRegistry;
}

function mockBettingService(result: PlaceBetResult = { status: "dry_run" }): BettingService {
  return {
    placeBet: mock(() => Promise.resolve(result)),
  };
}

function mockSettlementService(): SettlementService {
  return {
    settleBets: mock(() => Promise.resolve({ settled: [], skipped: 0, errors: [] })),
  };
}

function mockRepo() {
  return {
    upsert: mock(() => Promise.resolve()),
    findById: mock(() => Promise.resolve(null)),
    findActive: mock(() => Promise.resolve([])),
    findByGameId: mock(() => Promise.resolve([])),
    findByStatus: mock(() => Promise.resolve([])),
  };
}

function mockPredictionsRepo() {
  return {
    create: mock(() => Promise.resolve()),
    findByCompetitor: mock(() => Promise.resolve([])),
    findByMarket: mock(() => Promise.resolve([])),
    findByFixtureAndCompetitor: mock(() => Promise.resolve([])),
  };
}

function buildDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    discovery: mockDiscovery(),
    footballClient: mockFootballClient(),
    registry: mockRegistry(),
    bettingService: mockBettingService(),
    settlementService: mockSettlementService(),
    marketsRepo: mockRepo() as unknown as PipelineDeps["marketsRepo"],
    fixturesRepo: mockRepo() as unknown as PipelineDeps["fixturesRepo"],
    predictionsRepo: mockPredictionsRepo() as unknown as PipelineDeps["predictionsRepo"],
    config: {
      ...DEFAULT_CONFIG,
      leagues: [{ id: 39, name: "Premier League", country: "England" }],
    },
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("createPipeline", () => {
  describe("runPredictions", () => {
    test("runs full prediction flow end-to-end", async () => {
      const deps = buildDeps();
      const pipeline = createPipeline(deps);
      const result = await pipeline.runPredictions();

      expect(result.eventsDiscovered).toBe(1);
      expect(result.fixturesFetched).toBe(1);
      expect(result.fixturesMatched).toBe(1);
      expect(result.fixturesProcessed).toBe(1);
      expect(result.predictionsGenerated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    test("persists markets during discovery", async () => {
      const marketsRepoMock = mockRepo();
      const deps = buildDeps({
        marketsRepo: marketsRepoMock as unknown as PipelineDeps["marketsRepo"],
      });
      const pipeline = createPipeline(deps);
      await pipeline.runPredictions();

      expect(marketsRepoMock.upsert).toHaveBeenCalled();
    });

    test("persists fixtures during fetching", async () => {
      const fixturesRepoMock = mockRepo();
      const deps = buildDeps({
        fixturesRepo: fixturesRepoMock as unknown as PipelineDeps["fixturesRepo"],
      });
      const pipeline = createPipeline(deps);
      await pipeline.runPredictions();

      expect(fixturesRepoMock.upsert).toHaveBeenCalled();
    });

    test("persists predictions after engine runs", async () => {
      const predictionsRepoMock = mockPredictionsRepo();
      const deps = buildDeps({
        predictionsRepo: predictionsRepoMock as unknown as PipelineDeps["predictionsRepo"],
      });
      const pipeline = createPipeline(deps);
      await pipeline.runPredictions();

      expect(predictionsRepoMock.create).toHaveBeenCalled();
    });

    test("calls bettingService.placeBet for each prediction", async () => {
      const betting = mockBettingService();
      const deps = buildDeps({ bettingService: betting });
      const pipeline = createPipeline(deps);
      await pipeline.runPredictions();

      expect(betting.placeBet).toHaveBeenCalledTimes(1);
    });

    test("counts placed bets correctly", async () => {
      const betting = mockBettingService({
        status: "placed",
        bet: {
          id: "bet-1",
          orderId: "order-1",
          marketId: "market-1",
          fixtureId: 100,
          competitorId: "baseline",
          tokenId: "tok1",
          side: "YES",
          amount: 5,
          price: 0.6,
          shares: 8.33,
        },
      });
      const deps = buildDeps({ bettingService: betting });
      const pipeline = createPipeline(deps);
      const result = await pipeline.runPredictions();

      expect(result.betsPlaced).toBe(1);
      expect(result.betsDryRun).toBe(0);
    });

    test("counts dry-run bets correctly", async () => {
      const betting = mockBettingService({ status: "dry_run" });
      const deps = buildDeps({ bettingService: betting });
      const pipeline = createPipeline(deps);
      const result = await pipeline.runPredictions();

      expect(result.betsDryRun).toBe(1);
      expect(result.betsPlaced).toBe(0);
    });

    test("counts skipped bets correctly", async () => {
      const betting = mockBettingService({ status: "skipped", reason: "duplicate" });
      const deps = buildDeps({ bettingService: betting });
      const pipeline = createPipeline(deps);
      const result = await pipeline.runPredictions();

      expect(result.betsSkipped).toBe(1);
    });

    test("error in one fixture does not prevent processing others", async () => {
      const market1 = makeMarket({ id: "m1", gameId: "100" });
      const market2 = makeMarket({ id: "m2", gameId: "200" });
      const event1 = makeEvent("e1", [market1]);
      const event2 = makeEvent("e2", [market2]);
      event2.title = "Team C vs Team D";

      const fixture1 = makeApiFixture(100);
      const fixture2 = makeApiFixture(200);
      fixture2.teams = {
        home: { id: 30, name: "Team C", logo: "", winner: null },
        away: { id: 40, name: "Team D", logo: "", winner: null },
      };

      let standingsCallCount = 0;
      const footballClient = mockFootballClient({
        getFixtures: mock(() => Promise.resolve(apiResponse([fixture1, fixture2]))),
        getStandings: mock(() => {
          standingsCallCount++;
          if (standingsCallCount === 1) {
            return Promise.reject(new Error("API rate limit"));
          }
          return Promise.resolve(apiResponse(makeStandingsResponse(30, 40)));
        }),
      });

      const deps = buildDeps({
        discovery: mockDiscovery([event1, event2]),
        footballClient,
      });
      const pipeline = createPipeline(deps);
      const result = await pipeline.runPredictions();

      // First fixture errored, second should still process
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.fixturesProcessed).toBe(1);
    });

    test("handles zero events gracefully", async () => {
      const deps = buildDeps({
        discovery: mockDiscovery([]),
      });
      const pipeline = createPipeline(deps);
      const result = await pipeline.runPredictions();

      expect(result.eventsDiscovered).toBe(0);
      expect(result.fixturesMatched).toBe(0);
      expect(result.predictionsGenerated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    test("handles zero fixtures gracefully", async () => {
      const footballClient = mockFootballClient({
        getFixtures: mock(() => Promise.resolve(apiResponse([] as ApiFixture[]))),
      });
      const deps = buildDeps({ footballClient });
      const pipeline = createPipeline(deps);
      const result = await pipeline.runPredictions();

      expect(result.fixturesFetched).toBe(0);
      expect(result.fixturesMatched).toBe(0);
    });

    test("handles zero matched fixtures gracefully", async () => {
      // Event with no gameId and mismatched title so no match
      const market = makeMarket({ gameId: null });
      const event = makeEvent("e1", [market]);
      event.title = "Unrelated Event";

      const deps = buildDeps({ discovery: mockDiscovery([event]) });
      const pipeline = createPipeline(deps);
      const result = await pipeline.runPredictions();

      expect(result.fixturesMatched).toBe(0);
      expect(result.fixturesProcessed).toBe(0);
    });

    test("handles engine errors without crashing", async () => {
      const registry = {
        register: mock(() => {}),
        getAll: mock(() => [
          {
            competitorId: "bad-engine",
            name: "Bad Engine",
            engine: mock(() => {
              throw new Error("Engine exploded");
            }),
          },
        ]),
        get: mock(() => undefined),
      } as unknown as CompetitorRegistry;

      const deps = buildDeps({ registry });
      const pipeline = createPipeline(deps);
      const result = await pipeline.runPredictions();

      expect(result.predictionsGenerated).toBe(0);
      expect(result.errors.some((e) => e.includes("bad-engine"))).toBe(true);
    });

    test("handles discovery failure gracefully", async () => {
      const discovery: MarketDiscovery = {
        discoverFootballMarkets: mock(() => Promise.reject(new Error("Network error"))),
        discoverFootballLeagues: mock(() => Promise.resolve([])),
        fetchActiveEvents: mock(() => Promise.resolve([])),
      };

      const deps = buildDeps({ discovery });
      const pipeline = createPipeline(deps);
      const result = await pipeline.runPredictions();

      expect(result.eventsDiscovered).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Discovery failed");
    });

    test("skips predictions when no engines registered", async () => {
      const emptyRegistry = {
        register: mock(() => {}),
        getAll: mock(() => []),
        get: mock(() => undefined),
      } as unknown as CompetitorRegistry;

      const deps = buildDeps({ registry: emptyRegistry });
      const pipeline = createPipeline(deps);
      const result = await pipeline.runPredictions();

      expect(result.predictionsGenerated).toBe(0);
      expect(result.fixturesProcessed).toBe(0);
    });

    test("handles missing standings for a team", async () => {
      // Return standings without the away team
      const onlyHomeStandings: ApiStandingsResponse[] = [
        {
          league: {
            id: 39,
            name: "Premier League",
            country: "England",
            logo: "",
            flag: "",
            season: 2024,
            standings: [
              [
                {
                  rank: 1,
                  team: { id: 10, name: "Team A", logo: "" },
                  points: 50,
                  goalsDiff: 20,
                  form: "WWWWW",
                  all: { played: 20, win: 15, draw: 3, lose: 2, goals: { for: 40, against: 20 } },
                  home: { played: 10, win: 8, draw: 1, lose: 1, goals: { for: 22, against: 8 } },
                  away: { played: 10, win: 7, draw: 2, lose: 1, goals: { for: 18, against: 12 } },
                },
              ],
            ],
          },
        },
      ];
      const footballClient = mockFootballClient({
        getStandings: mock(() => Promise.resolve(apiResponse(onlyHomeStandings))),
      });

      const deps = buildDeps({ footballClient });
      const pipeline = createPipeline(deps);
      const result = await pipeline.runPredictions();

      expect(result.errors.some((e) => e.includes("Standings not found"))).toBe(true);
      expect(result.fixturesProcessed).toBe(0);
    });
  });

  describe("runSettlement", () => {
    test("delegates to settlementService.settleBets", async () => {
      const settlement = mockSettlementService();
      const deps = buildDeps({ settlementService: settlement });
      const pipeline = createPipeline(deps);
      const result = await pipeline.runSettlement();

      expect(settlement.settleBets).toHaveBeenCalledTimes(1);
      expect(result.settled).toHaveLength(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    test("returns settlement results", async () => {
      const settlement: SettlementService = {
        settleBets: mock(() =>
          Promise.resolve({
            settled: [
              {
                betId: "b1",
                marketId: "m1",
                competitorId: "baseline",
                side: "YES" as const,
                outcome: "won" as const,
                profit: 5,
              },
            ],
            skipped: 2,
            errors: ["some error"],
          }),
        ),
      };

      const deps = buildDeps({ settlementService: settlement });
      const pipeline = createPipeline(deps);
      const result = await pipeline.runSettlement();

      expect(result.settled).toHaveLength(1);
      expect(result.skipped).toBe(2);
      expect(result.errors).toHaveLength(1);
    });
  });
});
