import { describe, expect, mock, test } from "bun:test";
import type { CompetitorRegistry } from "../../../src/competitors/registry.ts";
import type { PredictionOutput } from "../../../src/domain/contracts/prediction.ts";
import type { Market } from "../../../src/domain/models/market.ts";
import type { BettingService, PlaceBetResult } from "../../../src/domain/services/betting.ts";
import type { GammaClient } from "../../../src/infrastructure/polymarket/gamma-client.ts";
import type { GammaMarket } from "../../../src/infrastructure/polymarket/types.ts";
import type { FootballClient } from "../../../src/infrastructure/sports-data/client.ts";
import type {
  ApiFixture,
  ApiResponse,
  ApiStandingsResponse,
} from "../../../src/infrastructure/sports-data/types.ts";
import { DEFAULT_CONFIG } from "../../../src/orchestrator/config.ts";
import {
  createDiscoveryPipeline,
  type DiscoveryPipelineDeps,
} from "../../../src/orchestrator/discovery-pipeline.ts";
import {
  createPredictionPipeline,
  type PredictionPipelineDeps,
} from "../../../src/orchestrator/prediction-pipeline.ts";
import type { MarketDiscovery } from "../../../src/infrastructure/polymarket/market-discovery.ts";

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

function makeGammaMarket(overrides: Partial<GammaMarket> = {}): GammaMarket {
  return {
    id: "market-1",
    question: "Will Team A win?",
    conditionId: "0xabc",
    slug: "team-a-win",
    outcomes: JSON.stringify(["Yes", "No"]),
    outcomePrices: JSON.stringify(["0.65", "0.35"]),
    clobTokenIds: JSON.stringify(["tok1", "tok2"]),
    active: true,
    closed: false,
    acceptingOrders: true,
    liquidity: "1000",
    liquidityNum: 1000,
    volume: "5000",
    volumeNum: 5000,
    gameId: "100",
    sportsMarketType: "moneyline",
    bestBid: 0.64,
    bestAsk: 0.66,
    lastTradePrice: 0.65,
    orderPriceMinTickSize: 0.01,
    orderMinSize: 1,
    ...overrides,
  };
}

function mockGammaClient(overrides: Partial<GammaClient> = {}): GammaClient {
  return {
    getSports: mock(() => Promise.resolve([])),
    getEvents: mock(() => Promise.resolve([])),
    getTags: mock(() => Promise.resolve([])),
    getMarketById: mock(() => Promise.resolve(makeGammaMarket())),
    ...overrides,
  };
}

function mockMarketsRepo(overrides: Record<string, unknown> = {}) {
  return {
    upsert: mock(() => Promise.resolve()),
    findById: mock(() => Promise.resolve(null)),
    findActive: mock(() => Promise.resolve([] as ReturnType<typeof makeMarketRow>[])),
    findByGameId: mock(() => Promise.resolve([] as ReturnType<typeof makeMarketRow>[])),
    findByFixtureId: mock(() => Promise.resolve([] as ReturnType<typeof makeMarketRow>[])),
    findActiveWithFixture: mock(() => Promise.resolve([] as ReturnType<typeof makeMarketRow>[])),
    ...overrides,
  };
}

function mockFixturesRepo(overrides: Record<string, unknown> = {}) {
  return {
    upsert: mock(() => Promise.resolve()),
    findById: mock(() => Promise.resolve(null)),
    findByStatus: mock(() => Promise.resolve([] as ReturnType<typeof makeFixtureRow>[])),
    findScheduledUpcoming: mock(() => Promise.resolve([] as ReturnType<typeof makeFixtureRow>[])),
    ...overrides,
  };
}

function mockPredictionsRepo(overrides: Record<string, unknown> = {}) {
  return {
    create: mock(() => Promise.resolve()),
    findByCompetitor: mock(() => Promise.resolve([] as unknown[])),
    findByMarket: mock(() => Promise.resolve([] as unknown[])),
    findByFixtureAndCompetitor: mock(() => Promise.resolve([] as unknown[])),
    ...overrides,
  };
}

// ─── Fixture row builders (DB shape) ──────────────────────────────────

function makeFixtureRow(id = 100) {
  return {
    id,
    leagueId: 39,
    leagueName: "Premier League",
    leagueCountry: "England",
    leagueSeason: 2024,
    homeTeamId: 10,
    homeTeamName: "Team A",
    homeTeamLogo: "",
    awayTeamId: 20,
    awayTeamName: "Team B",
    awayTeamLogo: "",
    date: "2026-03-05T20:00:00Z",
    venue: "Stadium",
    status: "scheduled" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeMarketRow(fixtureId: number | null = 100) {
  return {
    id: "market-1",
    conditionId: "0xabc",
    slug: "team-a-win",
    question: "Will Team A win?",
    outcomes: ["Yes", "No"] as [string, string],
    outcomePrices: ["0.6", "0.4"] as [string, string],
    tokenIds: ["tok1", "tok2"] as [string, string],
    active: true,
    closed: false,
    acceptingOrders: true,
    liquidity: 1000,
    volume: 5000,
    gameId: "100",
    sportsMarketType: "moneyline",
    line: null,
    fixtureId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─── Discovery Pipeline Tests ─────────────────────────────────────────

function buildDiscoveryDeps(
  overrides: Partial<DiscoveryPipelineDeps> = {},
): DiscoveryPipelineDeps {
  return {
    discovery: mockDiscovery(),
    footballClient: mockFootballClient(),
    marketsRepo: mockMarketsRepo() as unknown as DiscoveryPipelineDeps["marketsRepo"],
    fixturesRepo: mockFixturesRepo() as unknown as DiscoveryPipelineDeps["fixturesRepo"],
    config: {
      ...DEFAULT_CONFIG,
      leagues: [
        {
          id: 39,
          name: "Premier League",
          country: "England",
          polymarketTagIds: [82],
          polymarketSeriesSlug: "premier-league",
        },
      ],
    },
    ...overrides,
  };
}

describe("createDiscoveryPipeline", () => {
  test("discovers events and fetches fixtures", async () => {
    const deps = buildDiscoveryDeps();
    const pipeline = createDiscoveryPipeline(deps);
    const result = await pipeline.run();

    expect(result.eventsDiscovered).toBe(1);
    expect(result.fixturesFetched).toBe(1);
    expect(result.fixturesMatched).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  test("persists markets with fixtureId", async () => {
    const marketsRepoMock = mockMarketsRepo();
    const deps = buildDiscoveryDeps({
      marketsRepo: marketsRepoMock as unknown as DiscoveryPipelineDeps["marketsRepo"],
    });
    const pipeline = createDiscoveryPipeline(deps);
    await pipeline.run();

    expect(marketsRepoMock.upsert).toHaveBeenCalled();
  });

  test("persists fixtures to DB", async () => {
    const fixturesRepoMock = mockFixturesRepo();
    const deps = buildDiscoveryDeps({
      fixturesRepo: fixturesRepoMock as unknown as DiscoveryPipelineDeps["fixturesRepo"],
    });
    const pipeline = createDiscoveryPipeline(deps);
    await pipeline.run();

    expect(fixturesRepoMock.upsert).toHaveBeenCalled();
  });

  test("handles discovery failure gracefully", async () => {
    const discovery: MarketDiscovery = {
      discoverFootballMarkets: mock(() => Promise.reject(new Error("Network error"))),
      fetchActiveEvents: mock(() => Promise.resolve([])),
    };

    const deps = buildDiscoveryDeps({ discovery });
    const pipeline = createDiscoveryPipeline(deps);
    const result = await pipeline.run();

    expect(result.eventsDiscovered).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Discovery failed");
  });

  test("handles zero events gracefully", async () => {
    const deps = buildDiscoveryDeps({
      discovery: mockDiscovery([]),
    });
    const pipeline = createDiscoveryPipeline(deps);
    const result = await pipeline.run();

    expect(result.eventsDiscovered).toBe(0);
    expect(result.fixturesMatched).toBe(0);
  });

  test("handles zero fixtures gracefully", async () => {
    const footballClient = mockFootballClient({
      getFixtures: mock(() => Promise.resolve(apiResponse([] as ApiFixture[]))),
    });
    const deps = buildDiscoveryDeps({ footballClient });
    const pipeline = createDiscoveryPipeline(deps);
    const result = await pipeline.run();

    expect(result.fixturesFetched).toBe(0);
    expect(result.fixturesMatched).toBe(0);
  });
});

// ─── Prediction Pipeline Tests ─────────────────────────────────────────

function buildPredictionDeps(
  overrides: Partial<PredictionPipelineDeps> = {},
): PredictionPipelineDeps {
  return {
    gammaClient: mockGammaClient(),
    footballClient: mockFootballClient(),
    registry: mockRegistry(),
    bettingService: mockBettingService(),
    marketsRepo: mockMarketsRepo() as unknown as PredictionPipelineDeps["marketsRepo"],
    fixturesRepo: mockFixturesRepo() as unknown as PredictionPipelineDeps["fixturesRepo"],
    predictionsRepo: mockPredictionsRepo() as unknown as PredictionPipelineDeps["predictionsRepo"],
    config: {
      ...DEFAULT_CONFIG,
      leagues: [
        {
          id: 39,
          name: "Premier League",
          country: "England",
          polymarketTagIds: [82],
          polymarketSeriesSlug: "premier-league",
        },
      ],
    },
    ...overrides,
  };
}

describe("createPredictionPipeline", () => {
  // Helper: builds fixtures + markets repos that return data for one fixture
  function withFixtureAndMarkets() {
    const fr = mockFixturesRepo({
      findScheduledUpcoming: mock(() => Promise.resolve([makeFixtureRow()])),
    });
    const mr = mockMarketsRepo({
      findByFixtureId: mock(() => Promise.resolve([makeMarketRow()])),
    });
    return { fr, mr };
  }

  test("processes fixtures from DB and generates predictions", async () => {
    const { fr, mr } = withFixtureAndMarkets();
    const pr = mockPredictionsRepo();

    const deps = buildPredictionDeps({
      fixturesRepo: fr as unknown as PredictionPipelineDeps["fixturesRepo"],
      marketsRepo: mr as unknown as PredictionPipelineDeps["marketsRepo"],
      predictionsRepo: pr as unknown as PredictionPipelineDeps["predictionsRepo"],
    });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.fixturesProcessed).toBe(1);
    expect(result.predictionsGenerated).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  test("always saves predictions regardless of bet outcome", async () => {
    const { fr, mr } = withFixtureAndMarkets();
    const pr = mockPredictionsRepo();
    const betting = mockBettingService({ status: "skipped", reason: "duplicate" });

    const deps = buildPredictionDeps({
      fixturesRepo: fr as unknown as PredictionPipelineDeps["fixturesRepo"],
      marketsRepo: mr as unknown as PredictionPipelineDeps["marketsRepo"],
      predictionsRepo: pr as unknown as PredictionPipelineDeps["predictionsRepo"],
      bettingService: betting,
    });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    // Prediction is saved even when bet is skipped
    expect(result.predictionsGenerated).toBe(1);
    expect(result.betsSkipped).toBe(1);
    expect(pr.create).toHaveBeenCalledTimes(1);
  });

  test("skips fixtures with no markets", async () => {
    const fr = mockFixturesRepo({
      findScheduledUpcoming: mock(() => Promise.resolve([makeFixtureRow()])),
    });

    const deps = buildPredictionDeps({
      fixturesRepo: fr as unknown as PredictionPipelineDeps["fixturesRepo"],
    });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.fixturesProcessed).toBe(0);
    expect(result.predictionsGenerated).toBe(0);
  });

  test("skips fixture when competitor already predicted", async () => {
    const { fr, mr } = withFixtureAndMarkets();
    const pr = mockPredictionsRepo({
      findByFixtureAndCompetitor: mock(() => Promise.resolve([{ id: 1 }])),
    });

    const deps = buildPredictionDeps({
      fixturesRepo: fr as unknown as PredictionPipelineDeps["fixturesRepo"],
      marketsRepo: mr as unknown as PredictionPipelineDeps["marketsRepo"],
      predictionsRepo: pr as unknown as PredictionPipelineDeps["predictionsRepo"],
    });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.predictionsGenerated).toBe(0);
    expect(pr.create).not.toHaveBeenCalled();
  });

  test("returns empty result when no scheduled fixtures", async () => {
    const deps = buildPredictionDeps();
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.fixturesProcessed).toBe(0);
    expect(result.predictionsGenerated).toBe(0);
  });

  test("skips predictions when no engines registered", async () => {
    const fr = mockFixturesRepo({
      findScheduledUpcoming: mock(() => Promise.resolve([makeFixtureRow()])),
    });

    const emptyRegistry = {
      register: mock(() => {}),
      getAll: mock(() => []),
      get: mock(() => undefined),
    } as unknown as CompetitorRegistry;

    const deps = buildPredictionDeps({
      fixturesRepo: fr as unknown as PredictionPipelineDeps["fixturesRepo"],
      registry: emptyRegistry,
    });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.predictionsGenerated).toBe(0);
  });

  test("refreshes odds from Gamma before running engines", async () => {
    const { fr, mr } = withFixtureAndMarkets();

    const gc = mockGammaClient({
      getMarketById: mock(() =>
        Promise.resolve(makeGammaMarket({ outcomePrices: JSON.stringify(["0.70", "0.30"]) })),
      ),
    });

    const deps = buildPredictionDeps({
      fixturesRepo: fr as unknown as PredictionPipelineDeps["fixturesRepo"],
      marketsRepo: mr as unknown as PredictionPipelineDeps["marketsRepo"],
      gammaClient: gc,
    });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.oddsRefreshed).toBe(1);
    expect(gc.getMarketById).toHaveBeenCalledWith("market-1");
  });

  test("odds refresh failure falls back to cached prices", async () => {
    const { fr, mr } = withFixtureAndMarkets();

    const gc = mockGammaClient({
      getMarketById: mock(() => Promise.reject(new Error("Network timeout"))),
    });

    const deps = buildPredictionDeps({
      fixturesRepo: fr as unknown as PredictionPipelineDeps["fixturesRepo"],
      marketsRepo: mr as unknown as PredictionPipelineDeps["marketsRepo"],
      gammaClient: gc,
    });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.oddsRefreshFailed).toBe(1);
    // Should still generate prediction with cached prices
    expect(result.predictionsGenerated).toBe(1);
  });

  test("handles engine errors without crashing", async () => {
    const { fr, mr } = withFixtureAndMarkets();

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

    const deps = buildPredictionDeps({
      fixturesRepo: fr as unknown as PredictionPipelineDeps["fixturesRepo"],
      marketsRepo: mr as unknown as PredictionPipelineDeps["marketsRepo"],
      registry,
    });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.predictionsGenerated).toBe(0);
    expect(result.errors.some((e: string) => e.includes("bad-engine"))).toBe(true);
  });

  test("handles missing standings for a team", async () => {
    const { fr, mr } = withFixtureAndMarkets();

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

    const deps = buildPredictionDeps({
      fixturesRepo: fr as unknown as PredictionPipelineDeps["fixturesRepo"],
      marketsRepo: mr as unknown as PredictionPipelineDeps["marketsRepo"],
      footballClient,
    });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.errors.some((e: string) => e.includes("Standings not found"))).toBe(true);
    expect(result.fixturesProcessed).toBe(0);
  });

  test("counts placed bets correctly", async () => {
    const { fr, mr } = withFixtureAndMarkets();

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

    const deps = buildPredictionDeps({
      fixturesRepo: fr as unknown as PredictionPipelineDeps["fixturesRepo"],
      marketsRepo: mr as unknown as PredictionPipelineDeps["marketsRepo"],
      bettingService: betting,
    });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.betsPlaced).toBe(1);
    expect(result.betsDryRun).toBe(0);
  });

  test("counts dry-run bets correctly", async () => {
    const { fr, mr } = withFixtureAndMarkets();

    const betting = mockBettingService({ status: "dry_run" });

    const deps = buildPredictionDeps({
      fixturesRepo: fr as unknown as PredictionPipelineDeps["fixturesRepo"],
      marketsRepo: mr as unknown as PredictionPipelineDeps["marketsRepo"],
      bettingService: betting,
    });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.betsDryRun).toBe(1);
    expect(result.betsPlaced).toBe(0);
  });
});
