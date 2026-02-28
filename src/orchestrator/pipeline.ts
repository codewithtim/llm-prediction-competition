import type { CompetitorRegistry } from "../competitors/registry.ts";
import type { MarketContext, Statistics } from "../domain/contracts/statistics.ts";
import type { Fixture } from "../domain/models/fixture.ts";
import type { Event, Market } from "../domain/models/market.ts";
import type { BettingService } from "../domain/services/betting.ts";
import { matchEventsToFixtures } from "../domain/services/market-matching.ts";
import type { SettlementResult, SettlementService } from "../domain/services/settlement.ts";
import { runAllEngines } from "../engine/runner.ts";
import type { EngineResult } from "../engine/types.ts";
import type { fixturesRepo as fixturesRepoFactory } from "../infrastructure/database/repositories/fixtures.ts";
import type { marketsRepo as marketsRepoFactory } from "../infrastructure/database/repositories/markets.ts";
import type { predictionsRepo as predictionsRepoFactory } from "../infrastructure/database/repositories/predictions.ts";
import type { MarketDiscovery } from "../infrastructure/polymarket/market-discovery.ts";
import type { FootballClient } from "../infrastructure/sports-data/client.ts";
import {
  mapApiFixtureToFixture,
  mapH2hFixturesToH2H,
  mapStandingToTeamStats,
} from "../infrastructure/sports-data/mappers.ts";
import { logger } from "../shared/logger.ts";
import type { PipelineConfig } from "./config.ts";

export type PipelineDeps = {
  discovery: MarketDiscovery;
  footballClient: FootballClient;
  registry: CompetitorRegistry;
  bettingService: BettingService;
  settlementService: SettlementService;
  marketsRepo: ReturnType<typeof marketsRepoFactory>;
  fixturesRepo: ReturnType<typeof fixturesRepoFactory>;
  predictionsRepo: ReturnType<typeof predictionsRepoFactory>;
  config: PipelineConfig;
};

export type PredictionPipelineResult = {
  eventsDiscovered: number;
  fixturesFetched: number;
  fixturesMatched: number;
  fixturesProcessed: number;
  predictionsGenerated: number;
  betsPlaced: number;
  betsDryRun: number;
  betsSkipped: number;
  errors: string[];
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

function formatDateISO(date: Date): string {
  return date.toISOString().split("T")[0] as string;
}

function fixtureToDbRow(fixture: Fixture) {
  return {
    id: fixture.id,
    leagueId: fixture.league.id,
    leagueName: fixture.league.name,
    leagueCountry: fixture.league.country,
    leagueSeason: fixture.league.season,
    homeTeamId: fixture.homeTeam.id,
    homeTeamName: fixture.homeTeam.name,
    homeTeamLogo: fixture.homeTeam.logo,
    awayTeamId: fixture.awayTeam.id,
    awayTeamName: fixture.awayTeam.name,
    awayTeamLogo: fixture.awayTeam.logo,
    date: fixture.date,
    venue: fixture.venue,
    status: fixture.status,
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

export function createPipeline(deps: PipelineDeps) {
  const {
    discovery,
    footballClient,
    registry,
    bettingService,
    settlementService,
    marketsRepo,
    fixturesRepo,
    predictionsRepo,
    config,
  } = deps;

  return {
    async runPredictions(): Promise<PredictionPipelineResult> {
      const result: PredictionPipelineResult = {
        eventsDiscovered: 0,
        fixturesFetched: 0,
        fixturesMatched: 0,
        fixturesProcessed: 0,
        predictionsGenerated: 0,
        betsPlaced: 0,
        betsDryRun: 0,
        betsSkipped: 0,
        errors: [],
      };

      // Step 1: Discover markets
      logger.info("Pipeline: discovering football markets");
      let events: Event[];
      try {
        events = await discovery.discoverFootballMarkets();
        result.eventsDiscovered = events.length;
        logger.info("Pipeline: markets discovered", { events: events.length });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Discovery failed: ${msg}`);
        logger.error("Pipeline: discovery failed", { error: msg });
        return result;
      }

      // Step 2: Persist markets
      for (const event of events) {
        for (const market of event.markets) {
          try {
            await marketsRepo.upsert(marketToDbRow(market));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push(`Market upsert failed (${market.id}): ${msg}`);
          }
        }
      }

      // Step 3: Fetch fixtures
      logger.info("Pipeline: fetching fixtures", { leagues: config.leagues.length });
      const today = new Date();
      const lookAhead = new Date(today);
      lookAhead.setDate(lookAhead.getDate() + config.fixtureLookAheadDays);
      const from = formatDateISO(today);
      const to = formatDateISO(lookAhead);

      const allFixtures: Fixture[] = [];
      for (const league of config.leagues) {
        try {
          const resp = await footballClient.getFixtures({
            league: league.id,
            season: config.season,
            from,
            to,
          });
          const fixtures = resp.response.map(mapApiFixtureToFixture);
          allFixtures.push(...fixtures);
          logger.info("Pipeline: fixtures fetched", {
            league: league.name,
            count: fixtures.length,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Fixtures fetch failed (${league.name}): ${msg}`);
          logger.error("Pipeline: fixture fetch failed", { league: league.name, error: msg });
        }
      }
      result.fixturesFetched = allFixtures.length;

      // Step 4: Persist fixtures
      for (const fixture of allFixtures) {
        try {
          await fixturesRepo.upsert(fixtureToDbRow(fixture));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Fixture upsert failed (${fixture.id}): ${msg}`);
        }
      }

      if (events.length === 0 || allFixtures.length === 0) {
        logger.info("Pipeline: no events or fixtures to match", {
          events: events.length,
          fixtures: allFixtures.length,
        });
        return result;
      }

      // Step 5: Match events to fixtures
      const matchResult = matchEventsToFixtures(events, allFixtures);
      result.fixturesMatched = matchResult.matched.length;
      logger.info("Pipeline: matching complete", {
        matched: matchResult.matched.length,
        unmatchedEvents: matchResult.unmatchedEvents.length,
        unmatchedFixtures: matchResult.unmatchedFixtures.length,
      });

      // Step 6: Process each matched fixture
      const engines = registry.getAll();
      if (engines.length === 0) {
        logger.warn("Pipeline: no engines registered, skipping predictions");
        return result;
      }

      for (const matched of matchResult.matched) {
        try {
          const { fixture } = matched;

          // Fetch standings
          const standingsResp = await footballClient.getStandings(
            fixture.league.id,
            fixture.league.season,
          );
          const allStandings = standingsResp.response.flatMap((r) => r.league.standings.flat());

          const homeStanding = allStandings.find((s) => s.team.id === fixture.homeTeam.id);
          const awayStanding = allStandings.find((s) => s.team.id === fixture.awayTeam.id);

          if (!homeStanding || !awayStanding) {
            result.errors.push(
              `Standings not found for fixture ${fixture.id} (${fixture.homeTeam.name} vs ${fixture.awayTeam.name})`,
            );
            continue;
          }

          const homeStats = mapStandingToTeamStats(homeStanding);
          const awayStats = mapStandingToTeamStats(awayStanding);

          // Fetch H2H
          const h2hResp = await footballClient.getHeadToHead(
            fixture.homeTeam.id,
            fixture.awayTeam.id,
          );
          const h2h = mapH2hFixturesToH2H(h2hResp.response, fixture.homeTeam.id);

          result.fixturesProcessed++;

          // Build market contexts for all markets on this fixture
          const marketMap = new Map(matched.markets.map((mm) => [mm.market.id, mm.market]));
          const marketContexts = matched.markets.map((mm) => buildMarketContext(mm.market));

          const statistics: Statistics = {
            fixtureId: fixture.id,
            league: fixture.league,
            homeTeam: homeStats,
            awayTeam: awayStats,
            h2h,
            markets: marketContexts,
          };

          // Run all engines ONCE per fixture
          const engineResults = await runAllEngines(engines, statistics);

          for (const engineResult of engineResults) {
            if ("error" in engineResult) {
              result.errors.push(
                `Engine ${engineResult.competitorId} failed on fixture ${fixture.id}: ${engineResult.error}`,
              );
              continue;
            }

            const { competitorId, predictions } = engineResult as EngineResult;

            for (const prediction of predictions) {
              // Resolve the Market object for this prediction
              const market = marketMap.get(prediction.marketId);
              if (!market) {
                result.errors.push(
                  `Engine ${competitorId} returned prediction for unknown market ${prediction.marketId}`,
                );
                continue;
              }

              result.predictionsGenerated++;

              // Persist prediction
              try {
                await predictionsRepo.create({
                  marketId: prediction.marketId,
                  fixtureId: fixture.id,
                  competitorId,
                  side: prediction.side,
                  confidence: prediction.confidence,
                  stake: prediction.stake,
                  reasoning: prediction.reasoning,
                });
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                result.errors.push(`Prediction save failed: ${msg}`);
              }

              // Place bet
              try {
                const engineEntry = engines.find((e) => e.competitorId === competitorId);
                const betResult = await bettingService.placeBet({
                  prediction,
                  market,
                  fixtureId: fixture.id,
                  competitorId,
                  walletConfig: engineEntry?.walletConfig,
                });

                if (betResult.status === "placed") result.betsPlaced++;
                else if (betResult.status === "dry_run") result.betsDryRun++;
                else result.betsSkipped++;
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                result.errors.push(`Bet placement failed: ${msg}`);
                result.betsSkipped++;
              }
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const fixtureLabel = `${matched.fixture.homeTeam.name} vs ${matched.fixture.awayTeam.name}`;
          result.errors.push(`Fixture processing failed (${fixtureLabel}): ${msg}`);
          logger.error("Pipeline: fixture processing failed", {
            fixture: matched.fixture.id,
            error: msg,
          });
        }
      }

      logger.info("Pipeline: prediction run complete", {
        fixturesProcessed: result.fixturesProcessed,
        predictions: result.predictionsGenerated,
        betsPlaced: result.betsPlaced,
        betsDryRun: result.betsDryRun,
        betsSkipped: result.betsSkipped,
        errors: result.errors.length,
      });

      return result;
    },

    async runSettlement(): Promise<SettlementResult> {
      logger.info("Pipeline: running settlement");
      const result = await settlementService.settleBets();
      logger.info("Pipeline: settlement complete", {
        settled: result.settled.length,
        skipped: result.skipped,
        errors: result.errors.length,
      });
      return result;
    },
  };
}

export type Pipeline = ReturnType<typeof createPipeline>;
