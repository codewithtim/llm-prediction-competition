import type { Fixture } from "../domain/models/fixture.ts";
import type { Event } from "../domain/models/market.ts";

type CacheEntry = {
  events: Event[];
  fixtures: Fixture[];
  timestamp: number;
};

export type DiscoveryCache = {
  get(): { events: Event[]; fixtures: Fixture[] } | null;
  set(events: Event[], fixtures: Fixture[]): void;
  clear(): void;
};

export function createDiscoveryCache(ttlMs: number): DiscoveryCache {
  let entry: CacheEntry | null = null;

  return {
    get() {
      if (!entry) return null;
      if (Date.now() - entry.timestamp > ttlMs) return null;
      return { events: entry.events, fixtures: entry.fixtures };
    },

    set(events: Event[], fixtures: Fixture[]) {
      entry = { events, fixtures, timestamp: Date.now() };
    },

    clear() {
      entry = null;
    },
  };
}
