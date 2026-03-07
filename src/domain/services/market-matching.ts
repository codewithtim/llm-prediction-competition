import { logger } from "@shared/logger.ts";
import type { Fixture } from "../models/fixture.ts";
import type { Event, Market } from "../models/market.ts";
import { datesMatchForFixture, parseEventTitle } from "./event-parser.ts";
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

    if (datesMatchForFixture(event.startDate, fixture.date)) return fixture;
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
  const matchedFixtureMap = new Map<number, MatchedFixture>();
  const matchedEventIds = new Set<string>();
  const matchedFixtureIds = new Set<number>();

  for (const event of events) {
    const fixture = matchByTeamNameAndDate(event, fixtures);
    if (!fixture) continue;

    matchedEventIds.add(event.id);
    matchedFixtureIds.add(fixture.id);

    let entry = matchedFixtureMap.get(fixture.id);
    if (!entry) {
      entry = { fixture, markets: [] };
      matchedFixtureMap.set(fixture.id, entry);
    }

    for (const market of event.markets) {
      const alreadyAdded = entry.markets.some((m) => m.market.id === market.id);
      if (!alreadyAdded) {
        entry.markets.push({
          market,
          eventId: event.id,
          eventTitle: event.title,
        });
      }
    }
  }

  const matched = Array.from(matchedFixtureMap.values());
  const unmatchedEvents = events.filter((e) => !matchedEventIds.has(e.id));
  const unmatchedFixtures = fixtures.filter((f) => !matchedFixtureIds.has(f.id));

  return { matched, unmatchedEvents, unmatchedFixtures };
}
