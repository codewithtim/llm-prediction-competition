# Feature 3: Polymarket Integration (Read-Only)

## Goal

Connect to Polymarket and discover football betting markets. Read-only — no order placement yet (that's Feature 8). Two clients are needed: a Gamma API client (plain HTTP) for market discovery, and a CLOB client wrapper (SDK) for real-time pricing.

---

## Architecture

```
Gamma API (HTTP)              CLOB API (SDK)
  GET /sports                   getOrderBook(tokenId)
  GET /events?tag_id=X          getMidpoint(tokenId)
        │                              │
        ▼                              ▼
  GammaClient                  PolymarketPricingClient
        │                              │
        ▼                              │
  mappers.ts                           │
  (GammaEvent → Event)                 │
  (GammaMarket → Market)               │
        │                              │
        ▼                              ▼
  MarketDiscovery  ◄──────────────────┘
  (orchestrates discovery + pricing)
```

---

## Files to Create

### 1. `src/infrastructure/polymarket/types.ts` — Raw Gamma API response types

These types represent what the Gamma API actually returns. They're different from our domain types — Gamma returns JSON strings for arrays, uses different field names, and includes fields we don't need.

```typescript
// What GET /sports returns
export type GammaSport = {
  id: number;
  sport: string;        // e.g. "epl", "la-liga", "soccer-ucl"
  image: string;
  resolution: string;   // Official league URL
  ordering: string;     // "home" or "away"
  tags: string;         // Comma-separated tag IDs: "1,82,306,100639,100350"
  series: string;       // Series identifier
  createdAt: string;
};

// What GET /events returns for a nested market
export type GammaMarket = {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  outcomes: string;        // JSON string: "[\"Yes\", \"No\"]"
  outcomePrices: string;   // JSON string: "[\"0.405\", \"0.595\"]"
  clobTokenIds: string;    // JSON string: "[\"token1\", \"token2\"]"
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean;
  liquidity: string;       // Numeric string
  liquidityNum: number;
  volume: string;          // Numeric string
  volumeNum: number;
  gameId: string | null;
  sportsMarketType: string | null;  // "moneyline" | "spreads" | "totals" | "both_teams_to_score"
  bestBid: number;
  bestAsk: number;
  lastTradePrice: number;
  orderPriceMinTickSize: number;
  orderMinSize: number;
};

// What GET /events returns at the event level
export type GammaEvent = {
  id: string;
  title: string;
  slug: string;
  startDate: string;
  endDate: string;
  active: boolean;
  closed: boolean;
  seriesSlug: string;      // e.g. "premier-league-2025"
  eventDate: string;       // Match date: "2026-03-05"
  startTime: string;       // Kick-off: "2026-03-05T20:00:00Z"
  score: string;           // e.g. "4-0" or ""
  elapsed: string;         // e.g. "90" or ""
  period: string;          // e.g. "FT" or ""
  markets: GammaMarket[];
};

// Query params for GET /events
export type GammaEventParams = {
  tag_id?: number;
  active?: boolean;
  closed?: boolean;
  limit?: number;
  offset?: number;
  order?: string;
  ascending?: boolean;
};
```

### 2. `src/infrastructure/polymarket/gamma-client.ts` — Gamma API HTTP client

Plain `fetch` calls to the Gamma API. No SDK — Polymarket doesn't provide one for Gamma.

```typescript
import { logger } from "@shared/logger.ts";
import type { GammaEvent, GammaEventParams, GammaSport } from "./types.ts";

const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";

export function createGammaClient() {
  return {
    async getSports(): Promise<GammaSport[]> {
      const res = await fetch(`${GAMMA_BASE_URL}/sports`);
      if (!res.ok) throw new Error(`Gamma /sports failed: ${res.status}`);
      return res.json();
    },

    async getEvents(params: GammaEventParams = {}): Promise<GammaEvent[]> {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) qs.set(key, String(value));
      }
      const url = `${GAMMA_BASE_URL}/events?${qs}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Gamma /events failed: ${res.status}`);
      return res.json();
    },
  };
}

export type GammaClient = ReturnType<typeof createGammaClient>;
```

**Trade-off:** We could use a general HTTP utility, but `fetch` is built into Bun and sufficient. No need for `axios` or `ky`.

### 3. `src/infrastructure/polymarket/pricing-client.ts` — CLOB SDK wrapper for pricing

Thin wrapper around `@polymarket/clob-client` for read-only pricing operations.

```typescript
import { ClobClient } from "@polymarket/clob-client";

const CLOB_BASE_URL = "https://clob.polymarket.com";
const POLYGON_CHAIN_ID = 137;

export function createPricingClient() {
  const clob = new ClobClient(CLOB_BASE_URL, POLYGON_CHAIN_ID);

  return {
    async getOrderBook(tokenId: string) {
      return clob.getOrderBook(tokenId);
    },

    async getMidpoint(tokenId: string) {
      return clob.getMidpoint(tokenId);
    },

    async getPrice(tokenId: string, side: "BUY" | "SELL") {
      return clob.getPrice(tokenId, side);
    },

    async getSpread(tokenId: string) {
      return clob.getSpread(tokenId);
    },

    async getPricesHistory(params: {
      market?: string;
      startTs?: number;
      endTs?: number;
      fidelity?: number;
    }) {
      return clob.getPricesHistory(params);
    },
  };
}

export type PricingClient = ReturnType<typeof createPricingClient>;
```

**Trade-off:** We wrap rather than expose the ClobClient directly so that:
1. We control the API surface (only expose methods we need)
2. Tests can mock the wrapper without mocking the SDK internals
3. If we ever need to add caching or rate limiting, it goes in one place

### 4. `src/infrastructure/polymarket/mappers.ts` — Gamma → domain type mappers

Pure functions that transform raw Gamma API responses into our domain `Market` and `Event` types. These handle the JSON string parsing that Gamma requires.

```typescript
import type { Event, Market } from "@domain/models/market.ts";
import type { GammaEvent, GammaMarket } from "./types.ts";

export function mapGammaMarketToMarket(raw: GammaMarket): Market {
  const outcomes = JSON.parse(raw.outcomes) as [string, string];
  const outcomePrices = JSON.parse(raw.outcomePrices) as [string, string];
  const tokenIds = JSON.parse(raw.clobTokenIds) as [string, string];

  return {
    id: raw.id,
    conditionId: raw.conditionId,
    slug: raw.slug,
    question: raw.question,
    outcomes,
    outcomePrices,
    tokenIds,
    active: raw.active,
    closed: raw.closed,
    acceptingOrders: raw.acceptingOrders,
    liquidity: raw.liquidityNum,
    volume: raw.volumeNum,
    gameId: raw.gameId ?? null,
    sportsMarketType: raw.sportsMarketType ?? null,
    line: null, // Gamma doesn't expose line on the market object; parse from question if needed
  };
}

export function mapGammaEventToEvent(raw: GammaEvent): Event {
  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    startDate: raw.startTime || raw.startDate,  // Prefer match time over creation date
    endDate: raw.endDate,
    active: raw.active,
    closed: raw.closed,
    markets: raw.markets.map(mapGammaMarketToMarket),
  };
}
```

**Trade-off — `line` field:** The spread/total line value (e.g., -1.5) isn't a separate field on Gamma markets. It's embedded in the question string (e.g., "Spread: Arsenal FC (-1.5)"). We could parse it from the question with regex, but for MVP we set it to `null` and revisit when we implement spread betting support.

### 5. `src/infrastructure/polymarket/market-discovery.ts` — High-level orchestration

Ties the Gamma client, mappers, and sport filtering together.

```typescript
import type { Event } from "@domain/models/market.ts";
import { logger } from "@shared/logger.ts";
import type { GammaClient } from "./gamma-client.ts";
import { mapGammaEventToEvent } from "./mappers.ts";
import type { GammaSport } from "./types.ts";

// Known football sport slugs on Polymarket
const FOOTBALL_SPORT_PREFIXES = ["epl", "la-liga", "serie-a", "bundesliga", "ligue-1", "soccer"];

export function isFootballSport(sport: GammaSport): boolean {
  return FOOTBALL_SPORT_PREFIXES.some(
    (prefix) => sport.sport === prefix || sport.sport.startsWith(`${prefix}-`) || sport.sport.startsWith("soccer"),
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

      // Use a single representative tag to avoid duplicates
      // Tag 82 covers soccer broadly based on research
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
```

**Trade-off — deduplication strategy:** Fetching by multiple tag IDs will return duplicates. We deduplicate by event ID in memory. An alternative would be to use a single known-good tag (like `82`), but that may miss leagues. We iterate all football tags and deduplicate.

**Trade-off — pagination strategy:** Offset-based pagination. We fetch pages until we get fewer results than the limit. This is simple but could be slow if there are thousands of events. For MVP this is fine — we can add concurrency or caching later.

---

## Test Files

### 6. `tests/unit/infrastructure/polymarket/mappers.test.ts`

Pure function tests. No mocking needed.

- Test `mapGammaMarketToMarket` correctly parses JSON string fields
- Test `mapGammaMarketToMarket` handles null `gameId` and `sportsMarketType`
- Test `mapGammaEventToEvent` maps event fields and nested markets
- Test `mapGammaEventToEvent` prefers `startTime` over `startDate`

### 7. `tests/unit/infrastructure/polymarket/gamma-client.test.ts`

Uses `mock.module()` from Bun to mock `fetch`.

- Test `getSports()` returns parsed sports array
- Test `getEvents()` builds correct URL query params
- Test `getEvents()` throws on non-OK response
- Test `getSports()` throws on non-OK response

### 8. `tests/unit/infrastructure/polymarket/market-discovery.test.ts`

Mock the `GammaClient` dependency (passed via factory).

- Test `discoverFootballLeagues()` filters football sports from all sports
- Test `isFootballSport()` identifies EPL, La Liga, etc.
- Test `extractTagIds()` parses comma-separated tag strings and deduplicates
- Test `fetchActiveEvents()` paginates through results
- Test `discoverFootballMarkets()` deduplicates events across tags

---

## Files to Modify

- **`src/infrastructure/polymarket/.gitkeep`** — delete (replaced by real files)

---

## Files NOT Modified

- **`src/domain/models/market.ts`** — existing `Event` and `Market` types are sufficient. The Gamma API returns more fields (e.g. `seriesSlug`, `eventDate`, `score`), but our mappers extract only what the domain types need.
- **`src/shared/env.ts`** — no new env vars needed. Read-only CLOB client needs no auth. Gamma API is public.
- **`src/infrastructure/database/`** — no DB changes. Markets get persisted via the existing `marketsRepo.upsert()` from Feature 2, but the discovery code doesn't call the repo directly — that orchestration happens in Feature 10 (Pipeline).

---

## Dependencies

- `@polymarket/clob-client` — already installed (v5.2.4)
- `fetch` — built into Bun, no install needed
- No new packages needed

---

## Open Questions (resolved)

1. **Should we use the CLOB `getMarkets()` or Gamma `/events` for discovery?** → Gamma. The CLOB client's `getMarkets()` returns all markets without sport filtering. Gamma has `tag_id` filtering and sport metadata.

2. **Should the pricing client require auth?** → No. Read-only methods work without a wallet or API credentials. Auth is only needed for Feature 8 (order placement).

3. **Should we extend the domain `Event` type with sport fields?** → No, not for this feature. The existing `Event` shape is sufficient. Sport-specific metadata (league, teams) lives in the `Fixture` type (Feature 4). The `gameId` on `Market` bridges them.

---

## Todo List

### Phase 1: Types & Foundation
- [x] 1. Create `src/infrastructure/polymarket/types.ts` with `GammaSport`, `GammaMarket`, `GammaEvent`, `GammaEventParams` types
- [x] 2. Delete `src/infrastructure/polymarket/.gitkeep`

### Phase 2: Clients
- [x] 3. Create `src/infrastructure/polymarket/gamma-client.ts` — `createGammaClient()` with `getSports()` and `getEvents()`
- [x] 4. Create `src/infrastructure/polymarket/pricing-client.ts` — `createPricingClient()` wrapping CLOB SDK read-only methods
- [x] 5. Write `tests/unit/infrastructure/polymarket/gamma-client.test.ts` — mock fetch, test success and error paths

### Phase 3: Mappers
- [x] 6. Create `src/infrastructure/polymarket/mappers.ts` — `mapGammaMarketToMarket()` and `mapGammaEventToEvent()`
- [x] 7. Write `tests/unit/infrastructure/polymarket/mappers.test.ts` — JSON parsing, null handling, field mapping

### Phase 4: Market Discovery
- [x] 8. Create `src/infrastructure/polymarket/market-discovery.ts` — `isFootballSport()`, `extractTagIds()`, `createMarketDiscovery()`
- [x] 9. Write `tests/unit/infrastructure/polymarket/market-discovery.test.ts` — sport filtering, tag extraction, pagination, deduplication

### Phase 5: Verify
- [x] 10. Run `bun test` — all tests pass (76 tests, 0 failures)
- [x] 11. Run `bun run typecheck` — no TypeScript errors
- [x] 12. Run `bun run lint:fix` — no Biome errors
