import { logger } from "@shared/logger.ts";
import type { Fixture } from "../models/fixture.ts";
import type { Event, Market } from "../models/market.ts";
import { parseEventTitle, sameDateUTC } from "./event-parser.ts";
import { teamNamesMatch } from "./team-names.ts";

export type MatchedMarket = {
  market: Market;
  eventId: string;
  eventTitle: string;
};

export type MatchedFixture = {
  fixture: Fixture;
  markets: MatchedMarket[];
};

export type MatchResult = {
  matched: MatchedFixture[];
  unmatchedEvents: Event[];
  unmatchedFixtures: Fixture[];
};

function matchByGameId(market: Market, fixtureIndex: Map<number, Fixture>): Fixture | null {
  if (market.gameId === null) return null;
  const id = Number(market.gameId);
  if (Number.isNaN(id)) return null;
  return fixtureIndex.get(id) ?? null;
}

function matchByTeamNameAndDate(event: Event, fixtures: Fixture[]): Fixture | null {
  const parsed = parseEventTitle(event.title);
  if (!parsed) {
    logger.debug("Matching: event title unparseable", {
      eventId: event.id,
      title: event.title,
    });
    return null;
  }

  for (const fixture of fixtures) {
    const homeMatch =
      teamNamesMatch(parsed.homeTeam, fixture.homeTeam.name) ||
      teamNamesMatch(parsed.homeTeam, fixture.awayTeam.name);
    const awayMatch =
      teamNamesMatch(parsed.awayTeam, fixture.homeTeam.name) ||
      teamNamesMatch(parsed.awayTeam, fixture.awayTeam.name);

    if (!homeMatch || !awayMatch) continue;

    const dateMatch = sameDateUTC(event.startDate, fixture.date);
    if (dateMatch) return fixture;
  }

  logger.debug("Matching: no fixture found for event", {
    eventId: event.id,
    title: event.title,
    parsedHome: parsed.homeTeam,
    parsedAway: parsed.awayTeam,
    eventDate: event.startDate,
    fixtureCount: fixtures.length,
  });

  return null;
}

export function matchEventsToFixtures(events: Event[], fixtures: Fixture[]): MatchResult {
  const fixtureIndex = new Map<number, Fixture>();
  for (const fixture of fixtures) {
    fixtureIndex.set(fixture.id, fixture);
  }

  const matchedFixtureMap = new Map<number, MatchedFixture>();
  const matchedEventIds = new Set<string>();
  const matchedFixtureIds = new Set<number>();

  for (const event of events) {
    let eventMatched = false;

    for (const market of event.markets) {
      // Try gameId match first (per-market)
      let fixture = matchByGameId(market, fixtureIndex);

      // Fall back to team name + date match (per-event)
      if (!fixture) {
        fixture = matchByTeamNameAndDate(event, fixtures);
      }

      if (!fixture) continue;

      eventMatched = true;
      matchedFixtureIds.add(fixture.id);

      let entry = matchedFixtureMap.get(fixture.id);
      if (!entry) {
        entry = { fixture, markets: [] };
        matchedFixtureMap.set(fixture.id, entry);
      }

      // Deduplicate: don't add the same market twice
      const alreadyAdded = entry.markets.some((m) => m.market.id === market.id);
      if (!alreadyAdded) {
        entry.markets.push({
          market,
          eventId: event.id,
          eventTitle: event.title,
        });
      }
    }

    if (eventMatched) {
      matchedEventIds.add(event.id);
    }
  }

  const matched = Array.from(matchedFixtureMap.values());
  const unmatchedEvents = events.filter((e) => !matchedEventIds.has(e.id));
  const unmatchedFixtures = fixtures.filter((f) => !matchedFixtureIds.has(f.id));

  return { matched, unmatchedEvents, unmatchedFixtures };
}
