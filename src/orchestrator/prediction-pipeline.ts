import type { CompetitorRegistry } from "../competitors/registry.ts";
import type {
  Injury,
  MarketContext,
  PlayerSeasonStats,
  Statistics,
  TeamSeasonStats,
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
import type {
  fixtures as fixturesTable,
  markets as marketsTable,
} from "../infrastructure/database/schema.ts";
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

type MarketRow = typeof marketsTable.$inferSelect;
type FixtureRow = typeof fixturesTable.$inferSelect;

function dbRowToMarket(row: MarketRow): Market {
  return {
    id: row.id,
    conditionId: row.conditionId,
    slug: row.slug,
    question: row.question,
    outcomes: row.outcomes,
    outcomePrices: row.outcomePrices,
    tokenIds: row.tokenIds,
    active: row.active,
    closed: row.closed,
    acceptingOrders: row.acceptingOrders,
    liquidity: row.liquidity,
    volume: row.volume,
    gameId: row.gameId,
    sportsMarketType: row.sportsMarketType,
    line: row.line,
    polymarketUrl: row.polymarketUrl ?? null,
  };
}

function dbRowToFixture(row: FixtureRow): Fixture {
  return {
    id: row.id,
    league: {
      id: row.leagueId,
      name: row.leagueName,
      country: row.leagueCountry,
      season: row.leagueSeason,
    },
    homeTeam: {
      id: row.homeTeamId,
      name: row.homeTeamName,
      logo: row.homeTeamLogo,
    },
    awayTeam: {
      id: row.awayTeamId,
      name: row.awayTeamName,
      logo: row.awayTeamLogo,
    },
    date: row.date,
    venue: row.venue,
    status: row.status,
  };
}

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

  return {
    async run(): Promise<PredictionPipelineResult> {
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

      // Step 1: Read scheduled fixtures from DB
      const fixtureRows = await fixturesRepo.findScheduledUpcoming();
      logger.info("Prediction: found scheduled fixtures", { count: fixtureRows.length });

      if (fixtureRows.length === 0) {
        logger.info("Prediction: no scheduled fixtures to process");
        return result;
      }

      const engines = registry.getAll();
      if (engines.length === 0) {
        logger.warn("Prediction: no engines registered, skipping predictions");
        return result;
      }

      // Step 2: Process each fixture
      for (const fixtureRow of fixtureRows) {
        const fixture = dbRowToFixture(fixtureRow);
        const fixtureLabel = `${fixture.homeTeam.name} vs ${fixture.awayTeam.name}`;

        try {
          // Step 2a: Get markets linked to this fixture
          const marketRows = await marketsRepo.findByFixtureId(fixture.id);
          if (marketRows.length === 0) {
            logger.info("Prediction: no markets for fixture, skipping", {
              fixtureId: fixture.id,
              fixture: fixtureLabel,
            });
            continue;
          }

          // Step 2b: Refresh odds from Gamma and update DB
          const marketMap = new Map<string, Market>();
          for (const row of marketRows) {
            let market = dbRowToMarket(row);
            try {
              const freshGamma = await gammaClient.getMarketById(market.id);
              if (freshGamma) {
                const freshMarket = mapGammaMarketToMarket(freshGamma);
                if (freshMarket) {
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

          // Step 2c: Build market contexts from refreshed markets
          const marketContexts: MarketContext[] = [];
          for (const market of marketMap.values()) {
            marketContexts.push(buildMarketContext(market));
          }

          if (marketContexts.length === 0) continue;

          // Step 2d: Fetch standings and H2H
          const standingsResp = await footballClient.getStandings(
            fixture.league.id,
            fixture.league.season,
          );
          const allStandings = standingsResp.response.flatMap((r) => r.league.standings.flat());

          const homeStanding = allStandings.find((s) => s.team.id === fixture.homeTeam.id);
          const awayStanding = allStandings.find((s) => s.team.id === fixture.awayTeam.id);

          if (!homeStanding || !awayStanding) {
            result.errors.push(`Standings not found for fixture ${fixture.id} (${fixtureLabel})`);
            continue;
          }

          const homeStats = mapStandingToTeamStats(homeStanding);
          const awayStats = mapStandingToTeamStats(awayStanding);

          const h2hResp = await footballClient.getHeadToHead(
            fixture.homeTeam.id,
            fixture.awayTeam.id,
          );
          const h2h = mapH2hFixturesToH2H(h2hResp.response, fixture.homeTeam.id);

          // Step 2d-2: Fetch injuries (always fresh)
          let injuries: Injury[] = [];
          try {
            const injResp = await footballClient.getInjuries(fixture.id);
            injuries = mapApiInjuries(injResp.response);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn("Prediction: injuries fetch failed, continuing without", {
              fixtureId: fixture.id,
              error: msg,
            });
          }

          // Step 2d-3/4: Fetch team & player stats in parallel (with cache)
          async function fetchTeamSeasonStats(
            teamId: number,
          ): Promise<TeamSeasonStats | undefined> {
            const cached = await statsCache.getTeamStats(
              teamId,
              fixture.league.id,
              fixture.league.season,
              STATS_CACHE_TTL,
            );
            if (cached) return cached;
            // Pass fixture.date to prevent data leakage
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
              await statsCache.setPlayerStats(
                teamId,
                fixture.league.id,
                fixture.league.season,
                players,
              );
            }
            return summarisePlayerStats(players, injuries);
          }

          const [homeStatsResult, awayStatsResult, homePlayersResult, awayPlayersResult] =
            await Promise.allSettled([
              fetchTeamSeasonStats(fixture.homeTeam.id),
              fetchTeamSeasonStats(fixture.awayTeam.id),
              fetchPlayerStats(fixture.homeTeam.id),
              fetchPlayerStats(fixture.awayTeam.id),
            ]);

          const unpack = <T>(result: PromiseSettledResult<T>, label: string): T | undefined => {
            if (result.status === "fulfilled") return result.value;
            const msg =
              result.reason instanceof Error ? result.reason.message : String(result.reason);
            logger.warn(`Prediction: ${label} fetch failed`, { fixtureId: fixture.id, error: msg });
            return undefined;
          };

          const homeTeamSeasonStats = unpack(homeStatsResult, "home team stats");
          const awayTeamSeasonStats = unpack(awayStatsResult, "away team stats");
          const homeTeamPlayers = unpack(homePlayersResult, "home player stats");
          const awayTeamPlayers = unpack(awayPlayersResult, "away player stats");

          // Step 2e: Build statistics (enriched)
          const statistics: Statistics = {
            fixtureId: fixture.id,
            league: fixture.league,
            homeTeam: homeStats,
            awayTeam: awayStats,
            h2h,
            markets: marketContexts,
            injuries,
            homeTeamSeasonStats,
            awayTeamSeasonStats,
            homeTeamPlayers,
            awayTeamPlayers,
          };

          result.fixturesProcessed++;

          // Step 2f: Run all engines
          const engineResults = await runAllEngines(engines, statistics);

          // Step 2g: Process engine results
          for (const engineResult of engineResults) {
            if ("error" in engineResult) {
              result.errors.push(
                `Engine ${engineResult.competitorId} failed on fixture ${fixture.id}: ${engineResult.error}`,
              );
              continue;
            }

            const { competitorId, predictions } = engineResult as EngineResult;

            // Check if this competitor already has predictions for this fixture
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

            // Fetch bankroll once per competitor per fixture
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

              // Resolve fractional stake to absolute dollar amount
              const absoluteStake = prediction.stake * bankroll;

              // ALWAYS save prediction to DB (with resolved absolute amount)
              try {
                await predictionsRepo.create({
                  marketId: prediction.marketId,
                  fixtureId: fixture.id,
                  competitorId,
                  side: prediction.side,
                  confidence: prediction.confidence,
                  stake: absoluteStake,
                  reasoning: prediction.reasoning,
                });
                result.predictionsGenerated++;
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                result.errors.push(`Prediction save failed: ${msg}`);
              }

              // Validate stake against bankroll constraints before placing bet
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

              // Attempt bet with resolved absolute amount
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
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Fixture processing failed (${fixtureLabel}): ${msg}`);
          logger.error("Prediction: fixture processing failed", {
            fixture: fixture.id,
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
