/**
 * Integration tests for the prediction pipeline.
 *
 * Uses a real in-memory SQLite database with real repos, real registry,
 * and real pipeline wiring. Only external API calls (football API,
 * Polymarket Gamma) are mocked.
 *
 * The migration (0003_sports_and_leagues.sql) seeds:
 *   - sport: "football" (enabled)
 *   - leagues: PL (39, enabled), CL (2, enabled), La Liga (140, disabled),
 *     Serie A (135, disabled), Bundesliga (78, disabled), Ligue 1 (61, disabled),
 *     Championship (40, enabled), FA Cup (45, disabled)
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { GammaMarket } from "../../src/apis/polymarket/types.ts";
import type { FootballClient } from "../../src/apis/sports-data/client.ts";
import type {
  ApiFixture,
  ApiResponse,
  ApiStandingsResponse,
  ApiTeamStatisticsResponse,
} from "../../src/apis/sports-data/types.ts";
import { CompetitorRegistry } from "../../src/competitors/registry.ts";
import type { Database } from "../../src/database/client.ts";
import { fixturesRepo } from "../../src/database/repositories/fixtures.ts";
import { leaguesRepo } from "../../src/database/repositories/leagues.ts";
import { marketsRepo } from "../../src/database/repositories/markets.ts";
import { predictionsRepo } from "../../src/database/repositories/predictions.ts";
import { statsCacheRepo } from "../../src/database/repositories/stats-cache.ts";
import * as schema from "../../src/database/schema.ts";
import type { PredictionOutput } from "../../src/domain/contracts/prediction.ts";
import type { Statistics } from "../../src/domain/contracts/statistics.ts";
import type { BankrollProvider } from "../../src/domain/services/bankroll.ts";
import type { BettingService } from "../../src/domain/services/betting.ts";
import { DEFAULT_CONFIG } from "../../src/orchestrator/config.ts";
import {
  createPredictionPipeline,
  type PredictionPipelineDeps,
} from "../../src/orchestrator/prediction-pipeline.ts";

// ─── Database Setup ──────────────────────────────────────────────────

let db: Database;

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  db = drizzle(client, { schema }) as Database;
  await migrate(db, { migrationsFolder: "./drizzle" });
});

// ─── API Response Helpers ────────────────────────────────────────────

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

function makeMinuteStats(): Record<string, { total: number | null; percentage: string | null }> {
  return {
    "0-15": { total: 3, percentage: "10%" },
    "16-30": { total: 4, percentage: "13%" },
    "31-45": { total: 5, percentage: "17%" },
    "46-60": { total: 4, percentage: "13%" },
    "61-75": { total: 5, percentage: "17%" },
    "76-90": { total: 6, percentage: "20%" },
    "91-105": { total: 2, percentage: "7%" },
    "106-120": { total: 1, percentage: "3%" },
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

function makeApiTeamStatistics(
  teamId: number,
  teamName: string,
  leagueId: number,
): ApiTeamStatisticsResponse {
  return {
    league: { id: leagueId, name: "League", country: "Country", season: 2024 },
    team: { id: teamId, name: teamName, logo: "" },
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
    cards: { yellow: makeMinuteStats(), red: makeMinuteStats() },
  };
}

function makeStandings(
  leagueId: number,
  leagueName: string,
  teams: { id: number; name: string; rank: number }[],
): ApiStandingsResponse[] {
  const record = { played: 20, win: 12, draw: 5, lose: 3, goals: { for: 35, against: 15 } };
  return [
    {
      league: {
        id: leagueId,
        name: leagueName,
        country: "Country",
        logo: "",
        flag: "",
        season: 2024,
        standings: [
          teams.map((t) => ({
            rank: t.rank,
            team: { id: t.id, name: t.name, logo: "" },
            points: 60 - t.rank * 5,
            goalsDiff: 20 - t.rank * 3,
            form: "WWDLW",
            all: record,
            home: { ...record, played: 10, win: 7, draw: 2, lose: 1 },
            away: { ...record, played: 10, win: 5, draw: 3, lose: 2 },
          })),
        ],
      },
    },
  ];
}

function makeGammaMarket(marketId: string): GammaMarket {
  return {
    id: marketId,
    question: "Will the team win?",
    conditionId: "0xabc",
    slug: "team-win",
    outcomes: '["Yes","No"]',
    outcomePrices: '["0.65","0.35"]',
    clobTokenIds: '["tok1","tok2"]',
    active: true,
    closed: false,
    acceptingOrders: true,
    liquidity: "1000",
    liquidityNum: 1000,
    volume: "5000",
    volumeNum: 5000,
    gameId: null,
    sportsMarketType: "moneyline",
    bestBid: 0.64,
    bestAsk: 0.66,
    lastTradePrice: 0.65,
    orderPriceMinTickSize: 0.01,
    orderMinSize: 1,
  };
}

function makePrediction(marketId: string): PredictionOutput {
  return {
    marketId,
    side: "YES",
    confidence: 0.7,
    stake: 0.05,
    reasoning: {
      summary: "Team is stronger based on form",
      sections: [{ label: "Analysis", content: "Good recent form and standings" }],
    },
    extractedFeatures: { homeWinRate: 0.85, formDiff: 0.6 },
  };
}

// ─── Seed Helpers ────────────────────────────────────────────────────

async function seedFixture(fixture: typeof schema.fixtures.$inferInsert) {
  await db.insert(schema.fixtures).values(fixture);
}

async function seedMarket(market: typeof schema.markets.$inferInsert) {
  await db.insert(schema.markets).values(market);
}

async function seedCompetitor(id: string, name: string) {
  await db.insert(schema.competitors).values({
    id,
    name,
    model: "test-model",
    status: "active",
    type: "weight-tuned",
  });
}

// ─── Pipeline Builder ────────────────────────────────────────────────

function buildIntegrationDeps(overrides: {
  footballClient: FootballClient;
  registry: CompetitorRegistry;
}): PredictionPipelineDeps {
  const repos = {
    marketsRepo: marketsRepo(db),
    fixturesRepo: fixturesRepo(db),
    predictionsRepo: predictionsRepo(db),
    statsCache: statsCacheRepo(db),
    leaguesRepo: leaguesRepo(db),
  };

  const gammaClient = {
    getSports: mock(() => Promise.resolve([])),
    getEvents: mock(() => Promise.resolve([])),
    getTags: mock(() => Promise.resolve([])),
    getMarketById: mock((id: string) => Promise.resolve(makeGammaMarket(id))),
  };

  const bettingService: BettingService = {
    placeBet: mock(() =>
      Promise.resolve({ status: "dry_run" as const, betId: "dry-1", orderId: null }),
    ),
  };

  const bankrollProvider: BankrollProvider = {
    getBankroll: mock(() => Promise.resolve(100)),
  };

  return {
    gammaClient,
    footballClient: overrides.footballClient,
    registry: overrides.registry,
    bettingService,
    bankrollProvider,
    ...repos,
    config: {
      ...DEFAULT_CONFIG,
      predictionLeadTimeMs: 7 * 24 * 60 * 60 * 1000,
      betting: { ...DEFAULT_CONFIG.betting, dryRun: true },
    },
  };
}

// ─── Football Client Mock ────────────────────────────────────────────

function makeFootballClient(overrides: Partial<FootballClient> = {}): FootballClient {
  return {
    getFixtures: mock(() => Promise.resolve(apiResponse([] as ApiFixture[]))),
    getLeagues: mock(() => Promise.resolve(apiResponse([]))),
    getStandings: mock(() => Promise.resolve(apiResponse([] as ApiStandingsResponse[]))),
    getHeadToHead: mock(() =>
      Promise.resolve(
        apiResponse([
          {
            fixture: {
              id: 999,
              referee: null,
              timezone: "UTC",
              date: "2025-12-01T20:00:00Z",
              timestamp: 0,
              venue: { id: 1, name: "Stadium", city: "City" },
              status: { long: "Finished", short: "FT", elapsed: 90, extra: null },
            },
            league: {
              id: 39,
              name: "Premier League",
              country: "England",
              logo: "",
              flag: "",
              season: 2024,
              round: "Regular Season - 10",
            },
            teams: {
              home: { id: 10, name: "Team A", logo: "", winner: true },
              away: { id: 20, name: "Team B", logo: "", winner: false },
            },
            goals: { home: 2, away: 1 },
            score: {
              halftime: { home: 1, away: 0 },
              fulltime: { home: 2, away: 1 },
              extratime: { home: null, away: null },
              penalty: { home: null, away: null },
            },
          },
        ]),
      ),
    ),
    getInjuries: mock(() => Promise.resolve(apiResponse([]))),
    getTeamStatistics: mock((teamId: number, leagueId: number) =>
      Promise.resolve(apiResponse(makeApiTeamStatistics(teamId, `Team ${teamId}`, leagueId))),
    ),
    getPlayers: mock(() => Promise.resolve(apiResponse([]))),
    getAllPlayers: mock(() => Promise.resolve([])),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("Prediction Pipeline — Integration", () => {
  const fixtureDate = new Date(Date.now() + 2 * 60 * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");

  test("PL fixture: full flow from DB through engine to prediction storage", async () => {
    await seedFixture({
      id: 1001,
      leagueId: 39,
      leagueName: "Premier League",
      leagueCountry: "England",
      leagueSeason: 2024,
      homeTeamId: 42,
      homeTeamName: "Arsenal",
      homeTeamLogo: "",
      awayTeamId: 49,
      awayTeamName: "Chelsea",
      awayTeamLogo: "",
      date: fixtureDate,
      venue: "Emirates Stadium",
      status: "scheduled",
    });
    await seedMarket({
      id: "pl-market-1",
      conditionId: "0xabc",
      slug: "arsenal-win",
      question: "Will Arsenal win?",
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.6", "0.4"],
      tokenIds: ["tok1", "tok2"],
      active: true,
      closed: false,
      acceptingOrders: true,
      liquidity: 1000,
      volume: 5000,
      gameId: "1001",
      sportsMarketType: "moneyline",
      fixtureId: 1001,
    });
    await seedCompetitor("baseline", "Baseline Bot");

    const registry = new CompetitorRegistry();
    const engineFn = mock((stats: Statistics) => [makePrediction(stats.markets[0]!.marketId)]);
    registry.register("baseline", "Baseline Bot", engineFn);

    const fc = makeFootballClient({
      getStandings: mock(() =>
        Promise.resolve(
          apiResponse(
            makeStandings(39, "Premier League", [
              { id: 42, name: "Arsenal", rank: 1 },
              { id: 49, name: "Chelsea", rank: 5 },
            ]),
          ),
        ),
      ),
    });

    const deps = buildIntegrationDeps({ footballClient: fc, registry });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.fixturesProcessed).toBe(1);
    expect(result.predictionsGenerated).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Engine received correct statistics from real DB
    const statsArg = engineFn.mock.calls[0]![0] as Statistics;
    expect(statsArg.fixtureId).toBe(1001);
    expect(statsArg.homeTeam.teamId).toBe(42);
    expect(statsArg.homeTeam.teamName).toBe("Arsenal");
    expect(statsArg.awayTeam.teamId).toBe(49);
    expect(statsArg.awayTeam.teamName).toBe("Chelsea");
    expect(statsArg.markets).toHaveLength(1);
    expect(statsArg.markets[0]!.marketId).toBe("pl-market-1");

    // Prediction persisted in real DB
    const repo = predictionsRepo(db);
    const stored = await repo.findByFixtureAndCompetitor(1001, "baseline");
    expect(stored).toHaveLength(1);
    expect(stored[0]!.side).toBe("YES");
    expect(stored[0]!.confidence).toBe(0.7);
    expect(stored[0]!.marketId).toBe("pl-market-1");
  });

  test("CL fixture: resolves domestic standings for each team", async () => {
    await seedFixture({
      id: 5001,
      leagueId: 2,
      leagueName: "Champions League",
      leagueCountry: "World",
      leagueSeason: 2024,
      homeTeamId: 541,
      homeTeamName: "Real Madrid",
      homeTeamLogo: "",
      awayTeamId: 50,
      awayTeamName: "Manchester City",
      awayTeamLogo: "",
      date: fixtureDate,
      venue: "Santiago Bernabeu",
      status: "scheduled",
    });
    await seedMarket({
      id: "cl-market-1",
      conditionId: "0xdef",
      slug: "real-madrid-win",
      question: "Will Real Madrid win?",
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.55", "0.45"],
      tokenIds: ["tok3", "tok4"],
      active: true,
      closed: false,
      acceptingOrders: true,
      liquidity: 2000,
      volume: 8000,
      gameId: "5001",
      sportsMarketType: "moneyline",
      fixtureId: 5001,
    });
    await seedCompetitor("baseline", "Baseline Bot");

    const registry = new CompetitorRegistry();
    const engineFn = mock((stats: Statistics) => [makePrediction(stats.markets[0]!.marketId)]);
    registry.register("baseline", "Baseline Bot", engineFn);

    const standingsCallLeagues: number[] = [];
    const teamStatsCallLeagues: number[] = [];

    const fc = makeFootballClient({
      getStandings: mock((league: number, _season: number) => {
        standingsCallLeagues.push(league);
        if (league === 140) {
          return Promise.resolve(
            apiResponse(
              makeStandings(140, "La Liga", [{ id: 541, name: "Real Madrid", rank: 1 }]),
            ),
          );
        }
        if (league === 39) {
          return Promise.resolve(
            apiResponse(
              makeStandings(39, "Premier League", [
                { id: 50, name: "Manchester City", rank: 2 },
              ]),
            ),
          );
        }
        return Promise.resolve(apiResponse([] as ApiStandingsResponse[]));
      }),
      getTeamStatistics: mock(
        (teamId: number, leagueId: number, _season: number, _date?: string) => {
          teamStatsCallLeagues.push(leagueId);
          return Promise.resolve(
            apiResponse(makeApiTeamStatistics(teamId, `Team ${teamId}`, leagueId)),
          );
        },
      ),
    });

    const deps = buildIntegrationDeps({ footballClient: fc, registry });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.fixturesProcessed).toBe(1);
    expect(result.predictionsGenerated).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Standings fetched from domestic leagues, NOT CL (id=2)
    expect(standingsCallLeagues).not.toContain(2);
    expect(standingsCallLeagues).toContain(140); // La Liga for Real Madrid
    expect(standingsCallLeagues).toContain(39); // PL for Man City

    // Team stats from domestic leagues, not CL
    for (const leagueId of teamStatsCallLeagues) {
      expect(leagueId).not.toBe(2);
    }

    // Engine received correct team IDs
    const statsArg = engineFn.mock.calls[0]![0] as Statistics;
    expect(statsArg.fixtureId).toBe(5001);
    expect(statsArg.homeTeam.teamId).toBe(541);
    expect(statsArg.awayTeam.teamId).toBe(50);

    // Prediction persisted
    const repo = predictionsRepo(db);
    const stored = await repo.findByFixtureAndCompetitor(5001, "baseline");
    expect(stored).toHaveLength(1);
    expect(stored[0]!.marketId).toBe("cl-market-1");
  });

  test("CL fixture proceeds with empty stats when teams not in any domestic league", async () => {
    await seedFixture({
      id: 5002,
      leagueId: 2,
      leagueName: "Champions League",
      leagueCountry: "World",
      leagueSeason: 2024,
      homeTeamId: 999,
      homeTeamName: "Unknown FC",
      homeTeamLogo: "",
      awayTeamId: 998,
      awayTeamName: "Mystery United",
      awayTeamLogo: "",
      date: fixtureDate,
      venue: "Some Stadium",
      status: "scheduled",
    });
    await seedMarket({
      id: "cl-market-2",
      conditionId: "0xghi",
      slug: "unknown-fc-win",
      question: "Will Unknown FC win?",
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.5", "0.5"],
      tokenIds: ["tok5", "tok6"],
      active: true,
      closed: false,
      acceptingOrders: true,
      liquidity: 500,
      volume: 1000,
      gameId: "5002",
      sportsMarketType: "moneyline",
      fixtureId: 5002,
    });
    await seedCompetitor("baseline", "Baseline Bot");

    const registry = new CompetitorRegistry();
    registry.register("baseline", "Baseline Bot", (stats) => [
      makePrediction(stats.markets[0]!.marketId),
    ]);

    const fc = makeFootballClient({
      getStandings: mock(() => Promise.resolve(apiResponse([] as ApiStandingsResponse[]))),
    });

    const deps = buildIntegrationDeps({ footballClient: fc, registry });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.fixturesProcessed).toBe(1);
    expect(result.predictionsGenerated).toBe(1);
    expect(result.errors).toHaveLength(0);

    const repo = predictionsRepo(db);
    const stored = await repo.findByFixtureAndCompetitor(5002, "baseline");
    expect(stored).toHaveLength(1);
  });

  test("skips fixture that already has predictions for a competitor", async () => {
    await seedFixture({
      id: 1002,
      leagueId: 39,
      leagueName: "Premier League",
      leagueCountry: "England",
      leagueSeason: 2024,
      homeTeamId: 40,
      homeTeamName: "Liverpool",
      homeTeamLogo: "",
      awayTeamId: 33,
      awayTeamName: "Manchester United",
      awayTeamLogo: "",
      date: fixtureDate,
      venue: "Anfield",
      status: "scheduled",
    });
    await seedMarket({
      id: "pl-market-2",
      conditionId: "0xjkl",
      slug: "liverpool-win",
      question: "Will Liverpool win?",
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.7", "0.3"],
      tokenIds: ["tok7", "tok8"],
      active: true,
      closed: false,
      acceptingOrders: true,
      liquidity: 1500,
      volume: 6000,
      gameId: "1002",
      sportsMarketType: "moneyline",
      fixtureId: 1002,
    });
    await seedCompetitor("baseline", "Baseline Bot");

    // Pre-insert a prediction
    const repo = predictionsRepo(db);
    await repo.create({
      marketId: "pl-market-2",
      fixtureId: 1002,
      competitorId: "baseline",
      side: "YES",
      confidence: 0.8,
      stake: 3,
      reasoning: { summary: "Old prediction", sections: [{ label: "A", content: "B" }] },
    });

    const registry = new CompetitorRegistry();
    const engineFn = mock(() => [makePrediction("pl-market-2")]);
    registry.register("baseline", "Baseline Bot", engineFn);

    const fc = makeFootballClient({
      getStandings: mock(() =>
        Promise.resolve(
          apiResponse(
            makeStandings(39, "Premier League", [
              { id: 40, name: "Liverpool", rank: 2 },
              { id: 33, name: "Manchester United", rank: 7 },
            ]),
          ),
        ),
      ),
    });

    const deps = buildIntegrationDeps({ footballClient: fc, registry });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.fixturesProcessed).toBe(1);
    expect(result.predictionsGenerated).toBe(0);

    const stored = await repo.findByFixtureAndCompetitor(1002, "baseline");
    expect(stored).toHaveLength(1);
    expect(stored[0]!.confidence).toBe(0.8); // original, not overwritten
  });

  test("multiple competitors each get their own prediction for same fixture", async () => {
    await seedFixture({
      id: 1003,
      leagueId: 39,
      leagueName: "Premier League",
      leagueCountry: "England",
      leagueSeason: 2024,
      homeTeamId: 47,
      homeTeamName: "Tottenham",
      homeTeamLogo: "",
      awayTeamId: 48,
      awayTeamName: "West Ham",
      awayTeamLogo: "",
      date: fixtureDate,
      venue: "Tottenham Stadium",
      status: "scheduled",
    });
    await seedMarket({
      id: "pl-market-3",
      conditionId: "0xmno",
      slug: "tottenham-win",
      question: "Will Tottenham win?",
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.6", "0.4"],
      tokenIds: ["tok9", "tok10"],
      active: true,
      closed: false,
      acceptingOrders: true,
      liquidity: 800,
      volume: 3000,
      gameId: "1003",
      sportsMarketType: "moneyline",
      fixtureId: 1003,
    });
    await seedCompetitor("bot-a", "Bot A");
    await seedCompetitor("bot-b", "Bot B");

    const registry = new CompetitorRegistry();
    registry.register("bot-a", "Bot A", (stats) => [
      { ...makePrediction(stats.markets[0]!.marketId), confidence: 0.8, side: "YES" },
    ]);
    registry.register("bot-b", "Bot B", (stats) => [
      { ...makePrediction(stats.markets[0]!.marketId), confidence: 0.6, side: "NO" },
    ]);

    const fc = makeFootballClient({
      getStandings: mock(() =>
        Promise.resolve(
          apiResponse(
            makeStandings(39, "Premier League", [
              { id: 47, name: "Tottenham", rank: 6 },
              { id: 48, name: "West Ham", rank: 12 },
            ]),
          ),
        ),
      ),
    });

    const deps = buildIntegrationDeps({ footballClient: fc, registry });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.fixturesProcessed).toBe(1);
    expect(result.predictionsGenerated).toBe(2);

    const repo = predictionsRepo(db);
    const botA = await repo.findByFixtureAndCompetitor(1003, "bot-a");
    const botB = await repo.findByFixtureAndCompetitor(1003, "bot-b");
    expect(botA).toHaveLength(1);
    expect(botB).toHaveLength(1);
    expect(botA[0]!.side).toBe("YES");
    expect(botB[0]!.side).toBe("NO");
  });

  test("mixed PL and CL fixtures processed in same run", async () => {
    await seedFixture({
      id: 2001,
      leagueId: 39,
      leagueName: "Premier League",
      leagueCountry: "England",
      leagueSeason: 2024,
      homeTeamId: 42,
      homeTeamName: "Arsenal",
      homeTeamLogo: "",
      awayTeamId: 49,
      awayTeamName: "Chelsea",
      awayTeamLogo: "",
      date: fixtureDate,
      venue: "Emirates Stadium",
      status: "scheduled",
    });
    await seedMarket({
      id: "mixed-pl-market",
      conditionId: "0x111",
      slug: "arsenal-win-2",
      question: "Will Arsenal win?",
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.6", "0.4"],
      tokenIds: ["tok11", "tok12"],
      active: true,
      closed: false,
      acceptingOrders: true,
      liquidity: 1000,
      volume: 5000,
      gameId: "2001",
      sportsMarketType: "moneyline",
      fixtureId: 2001,
    });
    await seedFixture({
      id: 2002,
      leagueId: 2,
      leagueName: "Champions League",
      leagueCountry: "World",
      leagueSeason: 2024,
      homeTeamId: 529,
      homeTeamName: "Barcelona",
      homeTeamLogo: "",
      awayTeamId: 50,
      awayTeamName: "Manchester City",
      awayTeamLogo: "",
      date: fixtureDate,
      venue: "Camp Nou",
      status: "scheduled",
    });
    await seedMarket({
      id: "mixed-cl-market",
      conditionId: "0x222",
      slug: "barcelona-win",
      question: "Will Barcelona win?",
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.55", "0.45"],
      tokenIds: ["tok13", "tok14"],
      active: true,
      closed: false,
      acceptingOrders: true,
      liquidity: 2000,
      volume: 8000,
      gameId: "2002",
      sportsMarketType: "moneyline",
      fixtureId: 2002,
    });
    await seedCompetitor("baseline", "Baseline Bot");

    const registry = new CompetitorRegistry();
    registry.register("baseline", "Baseline Bot", (stats) => [
      makePrediction(stats.markets[0]!.marketId),
    ]);

    const standingsCallLeagues: number[] = [];

    const fc = makeFootballClient({
      getStandings: mock((league: number, _season: number) => {
        standingsCallLeagues.push(league);
        if (league === 39) {
          return Promise.resolve(
            apiResponse(
              makeStandings(39, "Premier League", [
                { id: 42, name: "Arsenal", rank: 1 },
                { id: 49, name: "Chelsea", rank: 5 },
                { id: 50, name: "Manchester City", rank: 2 },
              ]),
            ),
          );
        }
        if (league === 140) {
          return Promise.resolve(
            apiResponse(
              makeStandings(140, "La Liga", [{ id: 529, name: "Barcelona", rank: 2 }]),
            ),
          );
        }
        return Promise.resolve(apiResponse([] as ApiStandingsResponse[]));
      }),
    });

    const deps = buildIntegrationDeps({ footballClient: fc, registry });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.fixturesProcessed).toBe(2);
    expect(result.predictionsGenerated).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(standingsCallLeagues).not.toContain(2);

    const repo = predictionsRepo(db);
    const plPredictions = await repo.findByFixtureAndCompetitor(2001, "baseline");
    const clPredictions = await repo.findByFixtureAndCompetitor(2002, "baseline");
    expect(plPredictions).toHaveLength(1);
    expect(clPredictions).toHaveLength(1);
    expect(plPredictions[0]!.marketId).toBe("mixed-pl-market");
    expect(clPredictions[0]!.marketId).toBe("mixed-cl-market");
  });

  test("fixture without markets is skipped", async () => {
    await seedFixture({
      id: 3001,
      leagueId: 39,
      leagueName: "Premier League",
      leagueCountry: "England",
      leagueSeason: 2024,
      homeTeamId: 42,
      homeTeamName: "Arsenal",
      homeTeamLogo: "",
      awayTeamId: 49,
      awayTeamName: "Chelsea",
      awayTeamLogo: "",
      date: fixtureDate,
      venue: "Emirates Stadium",
      status: "scheduled",
    });
    await seedCompetitor("baseline", "Baseline Bot");

    const registry = new CompetitorRegistry();
    const engineFn = mock(() => [makePrediction("any-market")]);
    registry.register("baseline", "Baseline Bot", engineFn);

    const fc = makeFootballClient();
    const deps = buildIntegrationDeps({ footballClient: fc, registry });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.fixturesProcessed).toBe(0);
    expect(result.predictionsGenerated).toBe(0);
    expect(engineFn).not.toHaveBeenCalled();
  });

  test("fixtures from disabled leagues are not picked up", async () => {
    // Disable CL in the DB (migration seeds it as enabled)
    const leagues = leaguesRepo(db);
    await leagues.setEnabled(2, false);

    await seedFixture({
      id: 4001,
      leagueId: 2,
      leagueName: "Champions League",
      leagueCountry: "World",
      leagueSeason: 2024,
      homeTeamId: 541,
      homeTeamName: "Real Madrid",
      homeTeamLogo: "",
      awayTeamId: 50,
      awayTeamName: "Manchester City",
      awayTeamLogo: "",
      date: fixtureDate,
      venue: "Bernabeu",
      status: "scheduled",
    });
    await seedMarket({
      id: "disabled-market",
      conditionId: "0xzzz",
      slug: "rm-win",
      question: "Will Real Madrid win?",
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.5", "0.5"],
      tokenIds: ["tok99", "tok100"],
      active: true,
      closed: false,
      acceptingOrders: true,
      liquidity: 500,
      volume: 1000,
      gameId: "4001",
      sportsMarketType: "moneyline",
      fixtureId: 4001,
    });
    await seedCompetitor("baseline", "Baseline Bot");

    const registry = new CompetitorRegistry();
    registry.register("baseline", "Baseline Bot", () => [makePrediction("disabled-market")]);

    const fc = makeFootballClient();
    const deps = buildIntegrationDeps({ footballClient: fc, registry });
    const pipeline = createPredictionPipeline(deps);
    const result = await pipeline.run();

    expect(result.fixturesProcessed).toBe(0);
    expect(result.predictionsGenerated).toBe(0);
  });
});
