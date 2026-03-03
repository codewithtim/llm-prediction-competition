import { describe, expect, mock, test } from "bun:test";
import type { CompetitorRegistry } from "../../../src/competitors/registry.ts";
import type { PredictionOutput } from "../../../src/domain/contracts/prediction.ts";
import type { Market } from "../../../src/domain/models/market.ts";
import type { BankrollProvider } from "../../../src/domain/services/bankroll.ts";
import type { BettingService, PlaceBetResult } from "../../../src/domain/services/betting.ts";
import type { GammaClient } from "../../../src/infrastructure/polymarket/gamma-client.ts";
import type { MarketDiscovery } from "../../../src/infrastructure/polymarket/market-discovery.ts";
import type { GammaMarket } from "../../../src/infrastructure/polymarket/types.ts";
import type { FootballClient } from "../../../src/infrastructure/sports-data/client.ts";
import type {
  ApiFixture,
  ApiLeagueResponse,
  ApiResponse,
  ApiStandingsResponse,
  ApiTeamStatisticsResponse,
} from "../../../src/infrastructure/sports-data/types.ts";
import type { TeamSeasonStats } from "../../../src/domain/contracts/statistics.ts";
import { DEFAULT_CONFIG } from "../../../src/orchestrator/config.ts";
import {
  createDiscoveryPipeline,
  getCurrentSeason,
  type DiscoveryPipelineDeps,
} from "../../../src/orchestrator/discovery-pipeline.ts";
import {
  createPredictionPipeline,
  type PredictionPipelineDeps,
} from "../../../src/orchestrator/prediction-pipeline.ts";

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

function makeLeagueResponse(currentYear = 2024): ApiLeagueResponse[] {
  return [
    {
      league: { id: 39, name: "Premier League", type: "League", logo: "" },
      country: { name: "England", code: "GB", flag: null },
      seasons: [
        { year: 2023, start: "2023-08-11", end: "2024-05-19", current: false },
        { year: currentYear, start: "2024-08-16", end: "2025-05-25", current: true },
      ],
    },
  ];
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
    stake: 0.05,
    reasoning: {
      summary: "Team A is stronger",
      sections: [{ label: "Analysis", content: "Team A is stronger" }],
    },
    ...overrides,
  };
}

function makeMinuteStats(): Record<string, { total: number | null; percentage: string | null }> {
  return {
    "0-15": { total: 3, percentage: "10%" },
    "16-30": { total: 4, percentage: "13.33%" },
    "31-45": { total: 5, percentage: "16.67%" },
    "46-60": { total: 4, percentage: "13.33%" },
    "61-75": { total: 5, percentage: "16.67%" },
    "76-90": { total: 6, percentage: "20%" },
    "91-105": { total: 2, percentage: "6.67%" },
    "106-120": { total: 1, percentage: "3.33%" },
  };
}

function makeUnderOver(): Record<string, { over: number; under: number }> {
  return {
    "0.5": { over: 18, under: 2 },
    "1.5": { over: 14, under: 6 },
    "2.5": { over: 10, under: 10 },
    "3.5": { over: 5, under: 15 },
    "4.5": { over: 2, under: 18 },
  };
}

function makeApiTeamStatistics(): ApiTeamStatisticsResponse {
  return {
    league: { id: 39, name: "Premier League", country: "England", season: 2024 },
    team: { id: 10, name: "Team A", logo: "" },
    form: "WWDLW",
    fixtures: {
      played: { home: 10, away: 10, total: 20 },
      wins: { home: 7, away: 5, total: 12 },
      draws: { home: 2, away: 3, total: 5 },
      loses: { home: 1, away: 2, total: 3 },
    },
    goals: {
      for: {
        total: { home: 22, away: 15, total: 37 },
        average: { home: "2.2", away: "1.5", total: "1.85" },
        minute: makeMinuteStats(),
        under_over: makeUnderOver(),
      },
      against: {
        total: { home: 8, away: 12, total: 20 },
        average: { home: "0.8", away: "1.2", total: "1.0" },
        minute: makeMinuteStats(),
        under_over: makeUnderOver(),
      },
    },
    biggest: {
      streak: { wins: 5, draws: 2, loses: 1 },
      wins: { home: "4-0", away: "3-0" },
      loses: { home: "0-2", away: "0-3" },
      goals: { for: { home: 4, away: 3 }, against: { home: 2, away: 3 } },
    },
    clean_sheet: { home: 6, away: 3, total: 9 },
    failed_to_score: { home: 1, away: 3, total: 4 },
    penalty: {
      scored: { total: 4, percentage: "80%" },
      missed: { total: 1, percentage: "20%" },
      total: 5,
    },
    lineups: [{ formation: "4-3-3", played: 15 }],
    cards: {
      yellow: makeMinuteStats(),
      red: makeMinuteStats(),
    },
  };
}

function makeTeamSeasonStats(): TeamSeasonStats {
  const minuteStats = {
    "0-15": { total: 3 as number | null, percentage: "10%" as string | null },
    "16-30": { total: 4 as number | null, percentage: "13.33%" as string | null },
    "31-45": { total: 5 as number | null, percentage: "16.67%" as string | null },
    "46-60": { total: 4 as number | null, percentage: "13.33%" as string | null },
    "61-75": { total: 5 as number | null, percentage: "16.67%" as string | null },
    "76-90": { total: 6 as number | null, percentage: "20%" as string | null },
    "91-105": { total: 2 as number | null, percentage: "6.67%" as string | null },
    "106-120": { total: 1 as number | null, percentage: "3.33%" as string | null },
  };
  const underOver = {
    "0.5": { over: 18, under: 2 },
    "1.5": { over: 14, under: 6 },
    "2.5": { over: 10, under: 10 },
    "3.5": { over: 5, under: 15 },
    "4.5": { over: 2, under: 18 },
  };
  return {
    form: "WWDLW",
    fixtures: { played: { home: 10, away: 10, total: 20 } },
    cleanSheets: { home: 6, away: 3, total: 9 },
    failedToScore: { home: 1, away: 3, total: 4 },
    biggestStreak: { wins: 5, draws: 2, loses: 1 },
    penaltyRecord: { scored: 4, missed: 1, total: 5 },
    preferredFormations: [{ formation: "4-3-3", played: 15 }],
    goalsForByMinute: minuteStats,
    goalsAgainstByMinute: minuteStats,
    goalsForUnderOver: underOver,
    goalsAgainstUnderOver: underOver,
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
    getLeagues: mock(() => Promise.resolve(apiResponse(makeLeagueResponse()))),
    getStandings: mock(() => Promise.resolve(apiResponse(makeStandingsResponse()))),
    getHeadToHead: mock(() => Promise.resolve(apiResponse(makeH2hFixtures()))),
    getInjuries: mock(() => Promise.resolve(apiResponse([]))),
    getTeamStatistics: mock(() => Promise.resolve(apiResponse(makeApiTeamStatistics()))),
    getPlayers: mock(() => Promise.resolve(apiResponse([]))),
    getAllPlayers: mock(() => Promise.resolve([])),
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

function mockBankrollProvider(bankroll = 100): BankrollProvider {
  return {
    getBankroll: mock(() => Promise.resolve(bankroll)),
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
    bulkUpsert: mock(() => Promise.resolve()),
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
    bulkUpsert: mock(() => Promise.resolve()),
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
    polymarketUrl: "https://polymarket.com/sports/premier-league-2025/epl-tea-teb-2026-03-05",
    fixtureId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─── Discovery Pipeline Tests ─────────────────────────────────────────

function buildDiscoveryDeps(overrides: Partial<DiscoveryPipelineDeps> = {}): DiscoveryPipelineDeps {
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

// ─── getCurrentSeason Tests ──────────────────────────────────────────

describe("getCurrentSeason", () => {
  test("returns current season year from API", async () => {
    const client = mockFootballClient();
    const season = await getCurrentSeason(client, 39);
    expect(season).toBe(2024);
  });

  test("returns fallback when API fails", async () => {
    const client = mockFootballClient({
      getLeagues: mock(() => Promise.reject(new Error("API down"))),
    });
    const season = await getCurrentSeason(client, 39, 2023);
    expect(season).toBe(2023);
  });

  test("throws when API fails and no fallback provided", async () => {
    const client = mockFootballClient({
      getLeagues: mock(() => Promise.reject(new Error("API down"))),
    });
    await expect(getCurrentSeason(client, 39)).rejects.toThrow(
      "Cannot determine season for league 39",
    );
  });

  test("returns fallback when no current season in response", async () => {
    const noCurrentSeason: ApiLeagueResponse[] = [
      {
        league: { id: 39, name: "Premier League", type: "League", logo: "" },
        country: { name: "England", code: "GB", flag: null },
        seasons: [{ year: 2023, start: "2023-08-11", end: "2024-05-19", current: false }],
      },
    ];
    const client = mockFootballClient({
      getLeagues: mock(() => Promise.resolve(apiResponse(noCurrentSeason))),
    });
    const season = await getCurrentSeason(client, 39, 2022);
    expect(season).toBe(2022);
  });
});

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

    expect(marketsRepoMock.bulkUpsert).toHaveBeenCalled();
  });

  test("persists fixtures to DB", async () => {
    const fixturesRepoMock = mockFixturesRepo();
    const deps = buildDiscoveryDeps({
      fixturesRepo: fixturesRepoMock as unknown as DiscoveryPipelineDeps["fixturesRepo"],
    });
    const pipeline = createDiscoveryPipeline(deps);
    await pipeline.run();

    expect(fixturesRepoMock.bulkUpsert).toHaveBeenCalled();
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

function mockStatsCache(overrides: Record<string, unknown> = {}) {
  return {
    getTeamStats: mock(() => Promise.resolve(null)),
    setTeamStats: mock(() => Promise.resolve()),
    getPlayerStats: mock(() => Promise.resolve(null)),
    setPlayerStats: mock(() => Promise.resolve()),
    ...overrides,
  };
}

function buildPredictionDeps(
  overrides: Partial<PredictionPipelineDeps> = {},
): PredictionPipelineDeps {
  return {
    gammaClient: mockGammaClient(),
    footballClient: mockFootballClient(),
    registry: mockRegistry(),
    bettingService: mockBettingService(),
    bankrollProvider: mockBankrollProvider(),
    marketsRepo: mockMarketsRepo() as unknown as PredictionPipelineDeps["marketsRepo"],
    fixturesRepo: mockFixturesRepo() as unknown as PredictionPipelineDeps["fixturesRepo"],
    predictionsRepo: mockPredictionsRepo() as unknown as PredictionPipelineDeps["predictionsRepo"],
    statsCache: mockStatsCache() as unknown as PredictionPipelineDeps["statsCache"],
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

  test("preserves polymarketUrl during odds refresh", async () => {
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
    await pipeline.run();

    // The upsert should preserve the polymarketUrl from the DB row,
    // not overwrite it with null from mapGammaMarketToMarket
    const upsertCall = (mr.upsert as ReturnType<typeof mock>).mock.calls[0];
    expect(upsertCall[0].polymarketUrl).toBe(
      "https://polymarket.com/sports/premier-league-2025/epl-tea-teb-2026-03-05",
    );
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

  test("records error and skips competitor when bankroll fetch fails", async () => {
    const { fr, mr } = withFixtureAndMarkets();
    const betting = mockBettingService();

    const failingBankroll: BankrollProvider = {
      getBankroll: mock(() => Promise.reject(new Error("DB connection lost"))),
    };

    const deps = buildPredictionDeps({
      fixturesRepo: fr as unknown as PredictionPipelineDeps["fixturesRepo"],
      marketsRepo: mr as unknown as PredictionPipelineDeps["marketsRepo"],
      bankrollProvider: failingBankroll,
      bettingService: betting,
    });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.errors.some((e: string) => e.includes("Bankroll fetch failed"))).toBe(true);
    expect(result.errors.some((e: string) => e.includes("DB connection lost"))).toBe(true);
    expect(result.predictionsGenerated).toBe(0);
    expect(betting.placeBet).not.toHaveBeenCalled();
  });

  test("skips bet and increments betsSkipped when stake validation fails", async () => {
    const { fr, mr } = withFixtureAndMarkets();
    const betting = mockBettingService();

    // Engine returns a large stake fraction (50%), but pipeline cap is 10%
    const registry = mockRegistry([makePrediction({ stake: 0.5 })]);

    const deps = buildPredictionDeps({
      fixturesRepo: fr as unknown as PredictionPipelineDeps["fixturesRepo"],
      marketsRepo: mr as unknown as PredictionPipelineDeps["marketsRepo"],
      registry,
      bettingService: betting,
      bankrollProvider: mockBankrollProvider(100),
    });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    // Prediction is saved but bet is rejected
    expect(result.predictionsGenerated).toBe(1);
    expect(result.betsSkipped).toBe(1);
    expect(result.betsPlaced).toBe(0);
    expect(betting.placeBet).not.toHaveBeenCalled();
  });

  test("pipeline continues gracefully when injuries API fails", async () => {
    const { fr, mr } = withFixtureAndMarkets();
    const fc = mockFootballClient({
      getInjuries: mock(() => Promise.reject(new Error("Injuries API down"))),
    });

    const deps = buildPredictionDeps({
      fixturesRepo: fr as unknown as PredictionPipelineDeps["fixturesRepo"],
      marketsRepo: mr as unknown as PredictionPipelineDeps["marketsRepo"],
      footballClient: fc,
    });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.fixturesProcessed).toBe(1);
    expect(result.predictionsGenerated).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  test("pipeline continues gracefully when team stats API fails", async () => {
    const { fr, mr } = withFixtureAndMarkets();
    const fc = mockFootballClient({
      getTeamStatistics: mock(() => Promise.reject(new Error("Team stats API down"))),
    });

    const deps = buildPredictionDeps({
      fixturesRepo: fr as unknown as PredictionPipelineDeps["fixturesRepo"],
      marketsRepo: mr as unknown as PredictionPipelineDeps["marketsRepo"],
      footballClient: fc,
    });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.fixturesProcessed).toBe(1);
    expect(result.predictionsGenerated).toBe(1);
  });

  test("pipeline continues gracefully when player stats API fails", async () => {
    const { fr, mr } = withFixtureAndMarkets();
    const fc = mockFootballClient({
      getAllPlayers: mock(() => Promise.reject(new Error("Players API down"))),
    });

    const deps = buildPredictionDeps({
      fixturesRepo: fr as unknown as PredictionPipelineDeps["fixturesRepo"],
      marketsRepo: mr as unknown as PredictionPipelineDeps["marketsRepo"],
      footballClient: fc,
    });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.fixturesProcessed).toBe(1);
    expect(result.predictionsGenerated).toBe(1);
  });

  test("enriched statistics include injuries and season stats when available", async () => {
    const { fr, mr } = withFixtureAndMarkets();
    const engineFn = mock(() => [makePrediction()]);
    const registry = {
      register: mock(() => {}),
      getAll: mock(() => [
        { competitorId: "baseline", name: "Baseline", engine: engineFn },
      ]),
      get: mock(() => undefined),
    } as unknown as CompetitorRegistry;

    const injuryData = [
      {
        player: { id: 99, name: "Injured Player", photo: "", type: "Missing Fixture", reason: "Knee" },
        team: { id: 10, name: "Team A", logo: "" },
        fixture: { id: 100, timezone: "UTC", date: "2026-03-05T20:00:00Z", timestamp: 0 },
        league: { id: 39, season: 2024, name: "Premier League", country: "England" },
      },
    ];
    const fc = mockFootballClient({
      getInjuries: mock(() => Promise.resolve(apiResponse(injuryData))),
    });
    const sc = mockStatsCache({
      getTeamStats: mock(() => Promise.resolve(makeTeamSeasonStats())),
    });

    const deps = buildPredictionDeps({
      fixturesRepo: fr as unknown as PredictionPipelineDeps["fixturesRepo"],
      marketsRepo: mr as unknown as PredictionPipelineDeps["marketsRepo"],
      footballClient: fc,
      registry,
      statsCache: sc as unknown as PredictionPipelineDeps["statsCache"],
    });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.fixturesProcessed).toBe(1);
    expect(engineFn).toHaveBeenCalledTimes(1);

    const call = engineFn.mock.calls[0] as unknown[];
    const statsArg = call[0] as Record<string, unknown>;
    expect(Array.isArray(statsArg.injuries)).toBe(true);
    expect((statsArg.injuries as unknown[]).length).toBe(1);
    expect(statsArg.homeTeamSeasonStats).toBeDefined();
    expect(statsArg.awayTeamSeasonStats).toBeDefined();
  });

  test("uses cached team stats when available", async () => {
    const { fr, mr } = withFixtureAndMarkets();
    const sc = mockStatsCache({
      getTeamStats: mock(() => Promise.resolve(makeTeamSeasonStats())),
    });
    const fc = mockFootballClient();

    const deps = buildPredictionDeps({
      fixturesRepo: fr as unknown as PredictionPipelineDeps["fixturesRepo"],
      marketsRepo: mr as unknown as PredictionPipelineDeps["marketsRepo"],
      statsCache: sc as unknown as PredictionPipelineDeps["statsCache"],
      footballClient: fc,
    });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.fixturesProcessed).toBe(1);
    expect(fc.getTeamStatistics).not.toHaveBeenCalled();
  });
});
