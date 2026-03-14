import type { Event } from "@domain/models/market.ts";
import { logger } from "@shared/logger.ts";
import type { GammaClient } from "./gamma-client.ts";
import { mapGammaEventToEvent } from "./mappers.ts";
import type { GammaEvent } from "./types.ts";

export type MarketDiscoveryConfig = {
  leagues: Array<{ polymarketSeriesSlug: string }>;
  soccerTagId: number;
  lookAheadDays: number;
};

export function collectSeriesSlugs(config: MarketDiscoveryConfig): string[] {
  return config.leagues.map((l) => l.polymarketSeriesSlug);
}

export function filterBySeriesSlug(events: GammaEvent[], seriesSlugs: string[]): GammaEvent[] {
  return events.filter(
    (e) => e.seriesSlug && seriesSlugs.some((slug) => e.seriesSlug.startsWith(slug)),
  );
}

export function filterToMoneylineMarkets(event: GammaEvent): GammaEvent {
  return {
    ...event,
    markets: event.markets.filter((m) => m.sportsMarketType === "moneyline"),
  };
}

export function createMarketDiscovery(gamma: GammaClient, config: MarketDiscoveryConfig) {
  const seriesSlugs = collectSeriesSlugs(config);

  return {
    async fetchActiveEvents(tagId: number, limit = 50): Promise<Event[]> {
      const now = new Date();
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() + config.lookAheadDays);

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
          ascending: true,
          end_date_min: now.toISOString(),
          end_date_max: endDate.toISOString(),
        });

        if (batch.length === 0) break;

        const filtered = filterBySeriesSlug(batch, seriesSlugs)
          .map(filterToMoneylineMarkets)
          .filter((e) => e.markets.length > 0);

        events.push(...filtered.map(mapGammaEventToEvent));
        if (batch.length < limit) break;
        offset += limit;
      }

      logger.info("Fetched active football events", { tagId, count: events.length });
      return events;
    },

    async discoverFootballMarkets(): Promise<Event[]> {
      logger.info("Querying Soccer tag for all football events", {
        tagId: config.soccerTagId,
        seriesSlugs: seriesSlugs,
      });

      const events = await this.fetchActiveEvents(config.soccerTagId);

      logger.info("Total football events discovered", { count: events.length });
      return events;
    },
  };
}

export type MarketDiscovery = ReturnType<typeof createMarketDiscovery>;
