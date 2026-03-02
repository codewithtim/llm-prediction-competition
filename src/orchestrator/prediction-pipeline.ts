import type { CompetitorRegistry } from "../competitors/registry.ts";
import type { MarketContext, Statistics } from "../domain/contracts/statistics.ts";
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
import type {
  fixtures as fixturesTable,
  markets as marketsTable,
} from "../infrastructure/database/schema.ts";
import type { GammaClient } from "../infrastructure/polymarket/gamma-client.ts";
import { mapGammaMarketToMarket } from "../infrastructure/polymarket/mappers.ts";
import type { FootballClient } from "../infrastructure/sports-data/client.ts";
import {
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

          // Step 2e: Build statistics
          const statistics: Statistics = {
            fixtureId: fixture.id,
            league: fixture.league,
            homeTeam: homeStats,
            awayTeam: awayStats,
            h2h,
            markets: marketContexts,
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
