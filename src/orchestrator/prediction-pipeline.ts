import type { CompetitorRegistry } from "../competitors/registry.ts";
import type {
  H2H,
  Injury,
  MarketContext,
  PlayerSeasonStats,
  Statistics,
  TeamSeasonStats,
  TeamStats,
} from "../domain/contracts/statistics.ts";
import type { Fixture } from "../domain/models/fixture.ts";
import type { Market } from "../domain/models/market.ts";
import type { BankrollProvider } from "../domain/services/bankroll.ts";
import type { BettingService } from "../domain/services/betting.ts";
import { validateStake } from "../domain/services/stake-validator.ts";
import { runAllEngines } from "../engine/runner.ts";
import type { EngineResult } from "../engine/types.ts";
import type { fixturesRepo as fixturesRepoFactory } from "../infrastructure/database/repositories/fixtures.ts";
import type { marketsRepo as marketsRepoFactory } from "../infrastructure/database/repositories/markets.ts";
import type { predictionsRepo as predictionsRepoFactory } from "../infrastructure/database/repositories/predictions.ts";
import type { statsCacheRepo as statsCacheRepoFactory } from "../infrastructure/database/repositories/stats-cache.ts";
import type { GammaClient } from "../infrastructure/polymarket/gamma-client.ts";
import { mapGammaMarketToMarket } from "../infrastructure/polymarket/mappers.ts";
import type { FootballClient } from "../infrastructure/sports-data/client.ts";
import {
  mapApiInjuries,
  mapApiPlayerToPlayerStats,
  mapApiTeamStatistics,
  mapH2hFixturesToH2H,
  mapStandingToTeamStats,
} from "../infrastructure/sports-data/mappers.ts";
import { logger } from "../shared/logger.ts";
import type { PipelineConfig } from "./config.ts";
import { dbRowToFixture, dbRowToMarket } from "./converters.ts";

export type PredictionPipelineDeps = {
  gammaClient: GammaClient;
  footballClient: FootballClient;
  registry: CompetitorRegistry;
  bettingService: BettingService;
  bankrollProvider: BankrollProvider;
  marketsRepo: ReturnType<typeof marketsRepoFactory>;
  fixturesRepo: ReturnType<typeof fixturesRepoFactory>;
  predictionsRepo: ReturnType<typeof predictionsRepoFactory>;
  statsCache: ReturnType<typeof statsCacheRepoFactory>;
  config: PipelineConfig;
};

export type PredictionPipelineResult = {
  fixturesProcessed: number;
  predictionsGenerated: number;
  betsPlaced: number;
  betsDryRun: number;
  betsSkipped: number;
  oddsRefreshed: number;
  oddsRefreshFailed: number;
  errors: string[];
};

type PreFetchedFixtureData = {
  fixture: Fixture;
  fixtureLabel: string;
  marketRows: MarketRow[];
  homeStats: TeamStats;
  awayStats: TeamStats;
  h2h: H2H;
  injuries: Injury[];
  homeTeamSeasonStats?: TeamSeasonStats;
  awayTeamSeasonStats?: TeamSeasonStats;
  homeTeamPlayers?: PlayerSeasonStats[];
  awayTeamPlayers?: PlayerSeasonStats[];
};

function buildMarketContext(market: Market): MarketContext {
  return {
    marketId: market.id,
    question: market.question,
    currentYesPrice: Number.parseFloat(market.outcomePrices[0]),
    currentNoPrice: Number.parseFloat(market.outcomePrices[1]),
    liquidity: market.liquidity,
    volume: market.volume,
    sportsMarketType: market.sportsMarketType,
    line: market.line,
  };
}

const STATS_CACHE_TTL = 24 * 60 * 60 * 1000;

export function summarisePlayerStats(
  allPlayers: PlayerSeasonStats[],
  injuries: Injury[],
): PlayerSeasonStats[] {
  const sorted = [...allPlayers].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const top = sorted.slice(0, 8);
  const injuredIds = new Set(injuries.map((i) => i.playerId));
  for (const player of allPlayers) {
    if (injuredIds.has(player.playerId) && !top.find((p) => p.playerId === player.playerId)) {
      top.push(player);
    }
  }
  return top;
}

function marketToDbRow(market: Market) {
  return {
    id: market.id,
    conditionId: market.conditionId,
    slug: market.slug,
    question: market.question,
    outcomes: market.outcomes,
    outcomePrices: market.outcomePrices,
    tokenIds: market.tokenIds,
    active: market.active,
    closed: market.closed,
    acceptingOrders: market.acceptingOrders,
    liquidity: market.liquidity,
    volume: market.volume,
    gameId: market.gameId,
    sportsMarketType: market.sportsMarketType,
    line: market.line,
    polymarketUrl: market.polymarketUrl,
  };
}

async function fetchTeamSeasonStats(
  teamId: number,
  fixture: Fixture,
  footballClient: FootballClient,
  statsCache: ReturnType<typeof statsCacheRepoFactory>,
): Promise<TeamSeasonStats | undefined> {
  const cached = await statsCache.getTeamStats(
    teamId,
    fixture.league.id,
    fixture.league.season,
    STATS_CACHE_TTL,
  );
  if (cached) return cached;
  const resp = await footballClient.getTeamStatistics(
    teamId,
    fixture.league.id,
    fixture.league.season,
    fixture.date,
  );
  const mapped = mapApiTeamStatistics(resp.response);
  await statsCache.setTeamStats(teamId, fixture.league.id, fixture.league.season, mapped);
  return mapped;
}

async function fetchPlayerStats(
  teamId: number,
  fixture: Fixture,
  injuries: Injury[],
  footballClient: FootballClient,
  statsCache: ReturnType<typeof statsCacheRepoFactory>,
): Promise<PlayerSeasonStats[] | undefined> {
  const cached = await statsCache.getPlayerStats(
    teamId,
    fixture.league.id,
    fixture.league.season,
    STATS_CACHE_TTL,
  );
  let players: PlayerSeasonStats[];
  if (cached) {
    players = cached;
  } else {
    const raw = await footballClient.getAllPlayers(teamId, fixture.league.season);
    players = raw
      .map((p) => mapApiPlayerToPlayerStats(p, fixture.league.id))
      .filter((p): p is PlayerSeasonStats => p !== null && p.appearances > 0);
    await statsCache.setPlayerStats(teamId, fixture.league.id, fixture.league.season, players);
  }
  return summarisePlayerStats(players, injuries);
}

export function createPredictionPipeline(deps: PredictionPipelineDeps) {
  const {
    gammaClient,
    footballClient,
    registry,
    bettingService,
    bankrollProvider,
    marketsRepo,
    fixturesRepo,
    predictionsRepo,
    statsCache,
    config,
  } = deps;

  const standingsCache = new Map<string, Awaited<ReturnType<typeof footballClient.getStandings>>>();

  async function getStandingsCached(leagueId: number, season: number) {
    const key = `${leagueId}:${season}`;
    const cached = standingsCache.get(key);
    if (cached) return cached;
    const resp = await footballClient.getStandings(leagueId, season);
    standingsCache.set(key, resp);
    return resp;
  }

  async function gatherFixtureStats(
    fixtureRow: FixtureRow,
    result: PredictionPipelineResult,
  ): Promise<PreFetchedFixtureData | null> {
    const fixture = dbRowToFixture(fixtureRow);
    const fixtureLabel = `${fixture.homeTeam.name} vs ${fixture.awayTeam.name}`;

    const marketRows = await marketsRepo.findByFixtureId(fixture.id);
    if (marketRows.length === 0) {
      logger.info("Prediction: no markets for fixture, skipping", {
        fixtureId: fixture.id,
        fixture: fixtureLabel,
      });
      return null;
    }

    // Fetch standings, H2H, and injuries in parallel — they're independent
    const [standingsResp, h2hResp, injuriesResult] = await Promise.allSettled([
      getStandingsCached(fixture.league.id, fixture.league.season),
      footballClient.getHeadToHead(fixture.homeTeam.id, fixture.awayTeam.id),
      footballClient.getInjuries(fixture.id),
    ]);

    if (standingsResp.status === "rejected") {
      const msg =
        standingsResp.reason instanceof Error
          ? standingsResp.reason.message
          : String(standingsResp.reason);
      result.errors.push(
        `Standings fetch failed for fixture ${fixture.id} (${fixtureLabel}): ${msg}`,
      );
      return null;
    }

    const allStandings = standingsResp.value.response.flatMap((r) => r.league.standings.flat());
    const homeStanding = allStandings.find((s) => s.team.id === fixture.homeTeam.id);
    const awayStanding = allStandings.find((s) => s.team.id === fixture.awayTeam.id);

    if (!homeStanding || !awayStanding) {
      result.errors.push(`Standings not found for fixture ${fixture.id} (${fixtureLabel})`);
      return null;
    }

    const homeStats = mapStandingToTeamStats(homeStanding);
    const awayStats = mapStandingToTeamStats(awayStanding);

    let h2h: H2H;
    if (h2hResp.status === "fulfilled") {
      h2h = mapH2hFixturesToH2H(h2hResp.value.response, fixture.homeTeam.id);
    } else {
      const msg = h2hResp.reason instanceof Error ? h2hResp.reason.message : String(h2hResp.reason);
      logger.warn("Prediction: H2H fetch failed, using empty", {
        fixtureId: fixture.id,
        error: msg,
      });
      h2h = { totalMatches: 0, homeWins: 0, awayWins: 0, draws: 0, recentMatches: [] };
    }

    let injuries: Injury[] = [];
    if (injuriesResult.status === "fulfilled") {
      injuries = mapApiInjuries(injuriesResult.value.response);
    } else {
      const msg =
        injuriesResult.reason instanceof Error
          ? injuriesResult.reason.message
          : String(injuriesResult.reason);
      logger.warn("Prediction: injuries fetch failed, continuing without", {
        fixtureId: fixture.id,
        error: msg,
      });
    }

    const [homeStatsResult, awayStatsResult, homePlayersResult, awayPlayersResult] =
      await Promise.allSettled([
        fetchTeamSeasonStats(fixture.homeTeam.id, fixture, footballClient, statsCache),
        fetchTeamSeasonStats(fixture.awayTeam.id, fixture, footballClient, statsCache),
        fetchPlayerStats(fixture.homeTeam.id, fixture, injuries, footballClient, statsCache),
        fetchPlayerStats(fixture.awayTeam.id, fixture, injuries, footballClient, statsCache),
      ]);

    const unpack = <T>(settled: PromiseSettledResult<T>, label: string): T | undefined => {
      if (settled.status === "fulfilled") return settled.value;
      const msg = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
      logger.warn(`Prediction: ${label} fetch failed`, { fixtureId: fixture.id, error: msg });
      return undefined;
    };

    const homeTeamSeasonStats = unpack(homeStatsResult, "home team stats");
    const awayTeamSeasonStats = unpack(awayStatsResult, "away team stats");
    const homeTeamPlayers = unpack(homePlayersResult, "home player stats");
    const awayTeamPlayers = unpack(awayPlayersResult, "away player stats");

    if (!homeTeamSeasonStats || !awayTeamSeasonStats || !homeTeamPlayers || !awayTeamPlayers) {
      logger.warn("Prediction: incomplete enriched stats, continuing without", {
        fixtureId: fixture.id,
        fixture: fixtureLabel,
        missing: [
          !homeTeamSeasonStats && "home team stats",
          !awayTeamSeasonStats && "away team stats",
          !homeTeamPlayers && "home player stats",
          !awayTeamPlayers && "away player stats",
        ].filter(Boolean),
      });
    }

    return {
      fixture,
      fixtureLabel,
      marketRows,
      homeStats,
      awayStats,
      h2h,
      injuries,
      homeTeamSeasonStats,
      awayTeamSeasonStats,
      homeTeamPlayers,
      awayTeamPlayers,
    };
  }

  async function processFixture(
    data: PreFetchedFixtureData,
    engines: ReturnType<typeof registry.getAll>,
    result: PredictionPipelineResult,
  ): Promise<void> {
    const { fixture, marketRows } = data;

    // Refresh odds from Gamma and update DB
    const marketMap = new Map<string, Market>();
    for (const row of marketRows) {
      let market = dbRowToMarket(row);
      try {
        const freshGamma = await gammaClient.getMarketById(market.id);
        if (freshGamma) {
          const freshMarket = mapGammaMarketToMarket(freshGamma);
          if (freshMarket) {
            freshMarket.polymarketUrl = market.polymarketUrl;
            logger.info("Prediction: odds refreshed", {
              marketId: market.id,
              oldPrices: market.outcomePrices,
              newPrices: freshMarket.outcomePrices,
            });
            await marketsRepo.upsert(marketToDbRow(freshMarket));
            market = freshMarket;
            result.oddsRefreshed++;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn("Prediction: odds refresh failed, using cached prices", {
          marketId: market.id,
          error: msg,
        });
        result.oddsRefreshFailed++;
      }
      marketMap.set(market.id, market);
    }

    const marketContexts: MarketContext[] = [];
    for (const market of marketMap.values()) {
      marketContexts.push(buildMarketContext(market));
    }

    if (marketContexts.length === 0) return;

    const statistics: Statistics = {
      fixtureId: fixture.id,
      league: fixture.league,
      homeTeam: data.homeStats,
      awayTeam: data.awayStats,
      h2h: data.h2h,
      markets: marketContexts,
      injuries: data.injuries,
      homeTeamSeasonStats: data.homeTeamSeasonStats,
      awayTeamSeasonStats: data.awayTeamSeasonStats,
      homeTeamPlayers: data.homeTeamPlayers,
      awayTeamPlayers: data.awayTeamPlayers,
    };

    result.fixturesProcessed++;

    const engineResults = await runAllEngines(engines, statistics);

    for (const engineResult of engineResults) {
      if ("error" in engineResult) {
        result.errors.push(
          `Engine ${engineResult.competitorId} failed on fixture ${fixture.id}: ${engineResult.error}`,
        );
        continue;
      }

      const { competitorId, predictions } = engineResult as EngineResult;

      const existingPredictions = await predictionsRepo.findByFixtureAndCompetitor(
        fixture.id,
        competitorId,
      );
      if (existingPredictions.length > 0) {
        logger.info("Prediction: competitor already predicted for fixture, skipping", {
          competitorId,
          fixtureId: fixture.id,
        });
        continue;
      }

      let bankroll: number;
      try {
        bankroll = await bankrollProvider.getBankroll(competitorId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Bankroll fetch failed for ${competitorId}: ${msg}`);
        continue;
      }

      for (const prediction of predictions) {
        const market = marketMap.get(prediction.marketId);
        if (!market) {
          result.errors.push(
            `Engine ${competitorId} returned prediction for unknown market ${prediction.marketId}`,
          );
          continue;
        }

        const absoluteStake = prediction.stake * bankroll;

        try {
          await predictionsRepo.create({
            marketId: prediction.marketId,
            fixtureId: fixture.id,
            competitorId,
            side: prediction.side,
            confidence: prediction.confidence,
            stake: absoluteStake,
            reasoning: prediction.reasoning,
            extractedFeatures: prediction.extractedFeatures ?? null,
          });
          result.predictionsGenerated++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Prediction save failed: ${msg}`);
        }

        const validation = validateStake(absoluteStake, bankroll, {
          maxBetPctOfBankroll: config.betting.maxBetPctOfBankroll,
          minBetAmount: config.betting.minBetAmount,
        });

        if (!validation.valid) {
          logger.warn("Prediction: stake rejected", {
            competitorId,
            fixtureId: fixture.id,
            marketId: prediction.marketId,
            reason: validation.reason,
            requestedStake: absoluteStake,
            bankroll,
          });
          result.betsSkipped++;
          continue;
        }

        try {
          const engineEntry = engines.find((e) => e.competitorId === competitorId);
          const betResult = await bettingService.placeBet({
            prediction,
            resolvedStake: absoluteStake,
            market,
            fixtureId: fixture.id,
            competitorId,
            walletConfig: engineEntry?.walletConfig,
          });

          if (betResult.status === "placed") {
            result.betsPlaced++;
          } else if (betResult.status === "dry_run") {
            result.betsDryRun++;
          } else if (betResult.status === "failed") {
            result.betsSkipped++;
            logger.warn("Prediction: bet failed", {
              competitorId,
              fixtureId: fixture.id,
              marketId: market.id,
              error: betResult.error,
              errorCategory: betResult.errorCategory,
            });
          } else {
            result.betsSkipped++;
            logger.info("Prediction: bet skipped", {
              competitorId,
              fixtureId: fixture.id,
              marketId: market.id,
              reason: betResult.reason,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Bet placement failed: ${msg}`);
          result.betsSkipped++;
        }
      }
    }
  }

  return {
    async run(): Promise<PredictionPipelineResult> {
      standingsCache.clear();
      const result: PredictionPipelineResult = {
        fixturesProcessed: 0,
        predictionsGenerated: 0,
        betsPlaced: 0,
        betsDryRun: 0,
        betsSkipped: 0,
        oddsRefreshed: 0,
        oddsRefreshFailed: 0,
        errors: [],
      };

      const fixtureRows = await fixturesRepo.findReadyForPrediction(config.predictionLeadTimeMs);
      logger.info("Prediction: found fixtures ready for prediction", { count: fixtureRows.length });

      if (fixtureRows.length === 0) {
        logger.info("Prediction: no fixtures within prediction window");
        return result;
      }

      const engines = registry.getAll();
      if (engines.length === 0) {
        logger.warn("Prediction: no engines registered, skipping predictions");
        return result;
      }

      // Phase 1: Pre-fetch all stable data
      const preFetched: PreFetchedFixtureData[] = [];
      for (const fixtureRow of fixtureRows) {
        try {
          const data = await gatherFixtureStats(fixtureRow, result);
          if (data) preFetched.push(data);
        } catch (err) {
          const fixture = dbRowToFixture(fixtureRow);
          const fixtureLabel = `${fixture.homeTeam.name} vs ${fixture.awayTeam.name}`;
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Fixture processing failed (${fixtureLabel}): ${msg}`);
          logger.error("Prediction: fixture stats gathering failed", {
            fixture: fixture.id,
            error: msg,
          });
        }
      }

      // Phase 2: Tight odds→predict→bet per fixture
      for (const data of preFetched) {
        try {
          await processFixture(data, engines, result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Fixture processing failed (${data.fixtureLabel}): ${msg}`);
          logger.error("Prediction: fixture processing failed", {
            fixture: data.fixture.id,
            error: msg,
          });
        }
      }

      logger.info("Prediction: run complete", {
        fixturesProcessed: result.fixturesProcessed,
        predictions: result.predictionsGenerated,
        betsPlaced: result.betsPlaced,
        betsDryRun: result.betsDryRun,
        betsSkipped: result.betsSkipped,
        oddsRefreshed: result.oddsRefreshed,
        oddsRefreshFailed: result.oddsRefreshFailed,
        errors: result.errors.length,
      });

      for (const error of result.errors) {
        logger.error("Prediction error", { message: error });
      }

      return result;
    },
  };
}

export type PredictionPipeline = ReturnType<typeof createPredictionPipeline>;
