import type { Event } from "@domain/models/market.ts";
import { logger } from "@shared/logger.ts";
import type { GammaClient } from "./gamma-client.ts";
import { mapGammaEventToEvent } from "./mappers.ts";
import type { GammaSport } from "./types.ts";

const FOOTBALL_SPORT_PREFIXES = ["epl", "la-liga", "serie-a", "bundesliga", "ligue-1", "soccer"];

export function isFootballSport(sport: GammaSport): boolean {
  return FOOTBALL_SPORT_PREFIXES.some(
    (prefix) =>
      sport.sport === prefix ||
      sport.sport.startsWith(`${prefix}-`) ||
      sport.sport.startsWith("soccer"),
  );
}

export function extractTagIds(sports: GammaSport[]): number[] {
  const tagSet = new Set<number>();
  for (const sport of sports) {
    for (const tagStr of sport.tags.split(",")) {
      const tag = Number.parseInt(tagStr.trim(), 10);
      if (!Number.isNaN(tag)) tagSet.add(tag);
    }
  }
  return [...tagSet];
}

export function createMarketDiscovery(gamma: GammaClient) {
  return {
    async discoverFootballLeagues(): Promise<GammaSport[]> {
      const allSports = await gamma.getSports();
      return allSports.filter(isFootballSport);
    },

    async fetchActiveEvents(tagId: number, limit = 50): Promise<Event[]> {
      const events: Event[] = [];
      let offset = 0;

      while (true) {
        const batch = await gamma.getEvents({
          tag_id: tagId,
          active: true,
          closed: false,
          limit,
          offset,
          order: "startDate",
          ascending: false,
        });

        if (batch.length === 0) break;
        events.push(...batch.map(mapGammaEventToEvent));
        if (batch.length < limit) break;
        offset += limit;
      }

      logger.info("Fetched active football events", { tagId, count: events.length });
      return events;
    },

    async discoverFootballMarkets(): Promise<Event[]> {
      const footballSports = await this.discoverFootballLeagues();
      const tagIds = extractTagIds(footballSports);

      logger.info("Discovered football tag IDs", {
        leagues: footballSports.length,
        tagIds: tagIds.length,
      });

      const events: Event[] = [];
      const seenEventIds = new Set<string>();

      for (const tagId of tagIds) {
        const tagEvents = await this.fetchActiveEvents(tagId);
        for (const event of tagEvents) {
          if (!seenEventIds.has(event.id)) {
            seenEventIds.add(event.id);
            events.push(event);
          }
        }
      }

      logger.info("Total unique football events discovered", { count: events.length });
      return events;
    },
  };
}

export type MarketDiscovery = ReturnType<typeof createMarketDiscovery>;
