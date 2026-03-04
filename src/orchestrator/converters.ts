import type { fixtures as fixturesTable, markets as marketsTable } from "../database/schema.ts";
import type { Fixture } from "../domain/models/fixture.ts";
import type { Market } from "../domain/models/market.ts";
import type { MatchResult } from "../domain/services/market-matching.ts";

export type FixtureRow = typeof fixturesTable.$inferSelect;
export type MarketRow = typeof marketsTable.$inferSelect;

export function dbRowToFixture(row: FixtureRow): Fixture {
  return {
    id: row.id,
    league: {
      id: row.leagueId,
      name: row.leagueName,
      country: row.leagueCountry,
      season: row.leagueSeason,
    },
    homeTeam: { id: row.homeTeamId, name: row.homeTeamName, logo: row.homeTeamLogo },
    awayTeam: { id: row.awayTeamId, name: row.awayTeamName, logo: row.awayTeamLogo },
    date: row.date,
    venue: row.venue,
    status: row.status,
  };
}

export function dbRowToMarket(row: MarketRow): Market {
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

export function marketToDbRow(market: Market, fixtureId: number | null) {
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
    fixtureId,
  };
}

export function collectMarketRows(matchResult: MatchResult): ReturnType<typeof marketToDbRow>[] {
  const matchedMarketIds = new Set<string>();
  const rows: ReturnType<typeof marketToDbRow>[] = [];

  for (const matched of matchResult.matched) {
    for (const mm of matched.markets) {
      matchedMarketIds.add(mm.market.id);
      rows.push(marketToDbRow(mm.market, matched.fixture.id));
    }
  }

  for (const event of matchResult.unmatchedEvents) {
    for (const market of event.markets) {
      if (matchedMarketIds.has(market.id)) continue;
      rows.push(marketToDbRow(market, null));
    }
  }

  return rows;
}
