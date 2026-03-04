import type { Fixture } from "../domain/models/fixture.ts";
import type { Event } from "../domain/models/market.ts";
import { matchEventsToFixtures } from "../domain/services/market-matching.ts";
import type { fixturesRepo as fixturesRepoFactory } from "../infrastructure/database/repositories/fixtures.ts";
import type { marketsRepo as marketsRepoFactory } from "../infrastructure/database/repositories/markets.ts";
import type { MarketDiscovery } from "../infrastructure/polymarket/market-discovery.ts";
import { logger } from "../shared/logger.ts";
import { marketToDbRow } from "./discovery-pipeline.ts";

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

type DbFixtureRow = Awaited<ReturnType<ReturnType<typeof fixturesRepoFactory>["findAll"]>>[number];

function dbRowToFixture(row: DbFixtureRow): Fixture {
  return {
    id: row.id,
    league: {
      id: row.leagueId,
      name: row.leagueName,
      country: row.leagueCountry,
      season: row.leagueSeason,
    },
    homeTeam: { id: row.homeTeamId, name: row.homeTeamName, logo: row.homeTeamLogo ?? null },
    awayTeam: { id: row.awayTeamId, name: row.awayTeamName, logo: row.awayTeamLogo ?? null },
    date: row.date,
    venue: row.venue ?? null,
    status: row.status as Fixture["status"],
  };
}

export function createMarketRefreshPipeline(deps: MarketRefreshPipelineDeps) {
  const { discovery, marketsRepo, fixturesRepo } = deps;

  return {
    async run(): Promise<MarketRefreshPipelineResult> {
      const result: MarketRefreshPipelineResult = {
        eventsDiscovered: 0,
        marketsUpserted: 0,
        errors: [],
      };

      let events: Event[];
      logger.info("MarketRefresh: fetching markets from Gamma");
      try {
        events = await discovery.discoverFootballMarkets();
        result.eventsDiscovered = events.length;
        logger.info("MarketRefresh: events discovered", { count: events.length });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Gamma fetch failed: ${msg}`);
        logger.error("MarketRefresh: Gamma fetch failed", { error: msg });
        return result;
      }

      const dbFixtures = await fixturesRepo.findScheduledUpcoming();
      const fixtures = dbFixtures.map(dbRowToFixture);

      const matchResult = matchEventsToFixtures(events, fixtures);
      logger.info("MarketRefresh: matching complete", {
        matched: matchResult.matched.length,
        unmatchedEvents: matchResult.unmatchedEvents.length,
      });

      const matchedMarketIds = new Set<string>();
      const marketRows: ReturnType<typeof marketToDbRow>[] = [];

      for (const matched of matchResult.matched) {
        for (const mm of matched.markets) {
          matchedMarketIds.add(mm.market.id);
          marketRows.push(marketToDbRow(mm.market, matched.fixture.id));
        }
      }

      for (const event of matchResult.unmatchedEvents) {
        for (const market of event.markets) {
          if (matchedMarketIds.has(market.id)) continue;
          marketRows.push(marketToDbRow(market, null));
        }
      }

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
