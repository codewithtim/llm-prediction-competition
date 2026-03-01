import type { Fixture } from "../domain/models/fixture.ts";
import type { Event, Market } from "../domain/models/market.ts";
import { matchEventsToFixtures } from "../domain/services/market-matching.ts";
import type { fixturesRepo as fixturesRepoFactory } from "../infrastructure/database/repositories/fixtures.ts";
import type { marketsRepo as marketsRepoFactory } from "../infrastructure/database/repositories/markets.ts";
import type { MarketDiscovery } from "../infrastructure/polymarket/market-discovery.ts";
import type { FootballClient } from "../infrastructure/sports-data/client.ts";
import { mapApiFixtureToFixture } from "../infrastructure/sports-data/mappers.ts";
import { logger } from "../shared/logger.ts";
import type { PipelineConfig } from "./config.ts";

export type DiscoveryPipelineDeps = {
  discovery: MarketDiscovery;
  footballClient: FootballClient;
  marketsRepo: ReturnType<typeof marketsRepoFactory>;
  fixturesRepo: ReturnType<typeof fixturesRepoFactory>;
  config: PipelineConfig;
};

export type DiscoveryPipelineResult = {
  eventsDiscovered: number;
  fixturesFetched: number;
  fixturesMatched: number;
  marketsUpserted: number;
  fixturesUpserted: number;
  errors: string[];
};

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

function marketToDbRow(market: Market, fixtureId: number | null) {
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
    fixtureId,
  };
}

function formatDateISO(date: Date): string {
  return date.toISOString().split("T")[0] as string;
}

export function createDiscoveryPipeline(deps: DiscoveryPipelineDeps) {
  const { discovery, footballClient, marketsRepo, fixturesRepo, config } = deps;

  return {
    async run(): Promise<DiscoveryPipelineResult> {
      const result: DiscoveryPipelineResult = {
        eventsDiscovered: 0,
        fixturesFetched: 0,
        fixturesMatched: 0,
        marketsUpserted: 0,
        fixturesUpserted: 0,
        errors: [],
      };

      // Step 1: Discover markets from Polymarket
      let events: Event[];
      logger.info("Discovery: discovering football markets");
      try {
        events = await discovery.discoverFootballMarkets();
        result.eventsDiscovered = events.length;
        logger.info("Discovery: markets discovered", { events: events.length });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Discovery failed: ${msg}`);
        logger.error("Discovery: discovery failed", { error: msg });
        return result;
      }

      // Step 2: Fetch fixtures from API-Football
      const allFixtures: Fixture[] = [];
      logger.info("Discovery: fetching fixtures", { leagues: config.leagues.length });
      const today = new Date();
      const lookAhead = new Date(today);
      lookAhead.setDate(lookAhead.getDate() + config.fixtureLookAheadDays);
      const from = formatDateISO(today);
      const to = formatDateISO(lookAhead);

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
          logger.info("Discovery: fixtures fetched", {
            league: league.name,
            count: fixtures.length,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Fixtures fetch failed (${league.name}): ${msg}`);
          logger.error("Discovery: fixture fetch failed", { league: league.name, error: msg });
        }
      }
      result.fixturesFetched = allFixtures.length;

      // Step 3: Match events to fixtures
      const matchResult = matchEventsToFixtures(events, allFixtures);
      result.fixturesMatched = matchResult.matched.length;
      logger.info("Discovery: matching complete", {
        matched: matchResult.matched.length,
        unmatchedEvents: matchResult.unmatchedEvents.length,
        unmatchedFixtures: matchResult.unmatchedFixtures.length,
      });

      // Step 4: Upsert ALL fixtures to DB
      for (const fixture of allFixtures) {
        try {
          await fixturesRepo.upsert(fixtureToDbRow(fixture));
          result.fixturesUpserted++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Fixture upsert failed (${fixture.id}): ${msg}`);
        }
      }
      logger.info("Discovery: fixtures persisted", {
        upserted: result.fixturesUpserted,
        total: allFixtures.length,
      });

      // Step 5: Upsert matched markets with fixtureId set
      const matchedMarketIds = new Set<string>();
      for (const matched of matchResult.matched) {
        for (const mm of matched.markets) {
          matchedMarketIds.add(mm.market.id);
          try {
            await marketsRepo.upsert(marketToDbRow(mm.market, matched.fixture.id));
            result.marketsUpserted++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push(`Market upsert failed (${mm.market.id}): ${msg}`);
          }
        }
      }

      // Step 6: Upsert unmatched event markets with fixtureId = null
      for (const event of matchResult.unmatchedEvents) {
        for (const market of event.markets) {
          if (matchedMarketIds.has(market.id)) continue;
          try {
            await marketsRepo.upsert(marketToDbRow(market, null));
            result.marketsUpserted++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push(`Market upsert failed (${market.id}): ${msg}`);
          }
        }
      }

      logger.info("Discovery: markets persisted", { upserted: result.marketsUpserted });

      logger.info("Discovery: run complete", {
        eventsDiscovered: result.eventsDiscovered,
        fixturesFetched: result.fixturesFetched,
        fixturesMatched: result.fixturesMatched,
        marketsUpserted: result.marketsUpserted,
        fixturesUpserted: result.fixturesUpserted,
        errors: result.errors.length,
      });

      for (const error of result.errors) {
        logger.error("Discovery error", { message: error });
      }

      return result;
    },
  };
}

export type DiscoveryPipeline = ReturnType<typeof createDiscoveryPipeline>;
