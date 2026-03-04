import { matchEventsToFixtures } from "../domain/services/market-matching.ts";
import type { fixturesRepo as fixturesRepoFactory } from "../infrastructure/database/repositories/fixtures.ts";
import type { marketsRepo as marketsRepoFactory } from "../infrastructure/database/repositories/markets.ts";
import type { MarketDiscovery } from "../infrastructure/polymarket/market-discovery.ts";
import { logger } from "../shared/logger.ts";
import { collectMarketRows, dbRowToFixture } from "./converters.ts";

export type MarketRefreshPipelineDeps = {
  discovery: MarketDiscovery;
  marketsRepo: ReturnType<typeof marketsRepoFactory>;
  fixturesRepo: ReturnType<typeof fixturesRepoFactory>;
};

export type MarketRefreshPipelineResult = {
  eventsDiscovered: number;
  marketsUpserted: number;
  errors: string[];
};

export function createMarketRefreshPipeline(deps: MarketRefreshPipelineDeps) {
  const { discovery, marketsRepo, fixturesRepo } = deps;

  return {
    async run(): Promise<MarketRefreshPipelineResult> {
      const result: MarketRefreshPipelineResult = {
        eventsDiscovered: 0,
        marketsUpserted: 0,
        errors: [],
      };

      logger.info("MarketRefresh: fetching markets from Gamma");

      const [eventsResult, dbFixtures] = await Promise.allSettled([
        discovery.discoverFootballMarkets(),
        fixturesRepo.findScheduledUpcoming(),
      ]);

      if (eventsResult.status === "rejected") {
        const msg =
          eventsResult.reason instanceof Error
            ? eventsResult.reason.message
            : String(eventsResult.reason);
        result.errors.push(`Gamma fetch failed: ${msg}`);
        logger.error("MarketRefresh: Gamma fetch failed", { error: msg });
        return result;
      }

      const events = eventsResult.value;
      result.eventsDiscovered = events.length;
      logger.info("MarketRefresh: events discovered", { count: events.length });

      let fixtures: ReturnType<typeof dbRowToFixture>[] = [];
      if (dbFixtures.status === "fulfilled") {
        fixtures = dbFixtures.value.map(dbRowToFixture);
      } else {
        const msg =
          dbFixtures.reason instanceof Error
            ? dbFixtures.reason.message
            : String(dbFixtures.reason);
        logger.warn("MarketRefresh: fixtures fetch failed, matching will be skipped", {
          error: msg,
        });
        result.errors.push(`Fixtures fetch failed: ${msg}`);
      }

      const matchResult = matchEventsToFixtures(events, fixtures);
      logger.info("MarketRefresh: matching complete", {
        matched: matchResult.matched.length,
        unmatchedEvents: matchResult.unmatchedEvents.length,
      });

      const marketRows = collectMarketRows(matchResult);
      try {
        await marketsRepo.bulkUpsert(marketRows);
        result.marketsUpserted = marketRows.length;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Markets bulk upsert failed: ${msg}`);
        logger.error("MarketRefresh: bulk upsert failed", { error: msg });
      }

      logger.info("MarketRefresh: run complete", {
        eventsDiscovered: result.eventsDiscovered,
        marketsUpserted: result.marketsUpserted,
        errors: result.errors.length,
      });

      return result;
    },
  };
}

export type MarketRefreshPipeline = ReturnType<typeof createMarketRefreshPipeline>;
