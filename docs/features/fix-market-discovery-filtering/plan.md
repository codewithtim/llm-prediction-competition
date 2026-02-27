# Fix Polymarket Market Discovery Filtering

## Problem

Market discovery currently returns hundreds of irrelevant markets (esports, general markets) because:

1. **Broad tag matching** — `isFootballSport()` prefix matching catches sports whose tags include general tags (`1`, `100639`) that return everything on Polymarket
2. **No date filtering** — fetches ALL active events instead of just the upcoming look-ahead window
3. **Over-scoped discovery** — only EPL is configured in `DEFAULT_LEAGUES` but the discovery pulls in all football-adjacent leagues via `/sports` prefix matching

The root cause is that the current flow is: fetch `/sports` → match by name prefix → extract all tags from those sports → query `/events` per tag. Tags like `1` and `100639` are generic and return the entire Polymarket catalogue.

## Solution

Replace the dynamic sport-prefix-to-tag discovery with **configurable tag IDs per league** and add **date-range filtering** using Gamma API params (`start_date_min` / `start_date_max`).

---

## Changes

### 1. Extend Gamma types and client

**`src/infrastructure/polymarket/types.ts`**

- Add `GammaTag` type: `{ id: number; label: string; slug: string }`
- Extend `GammaEventParams` with optional date range fields: `start_date_min?: string`, `start_date_max?: string`, `end_date_min?: string`, `end_date_max?: string`

**`src/infrastructure/polymarket/gamma-client.ts`**

- Add `getTags()` method → `GET /tags` → returns `GammaTag[]`
- Existing `getEvents()` already passes all params to the query string, so it will pick up the new date fields automatically

### 2. Add `polymarketTagIds` to league config

**`src/orchestrator/config.ts`**

- Add `polymarketTagIds: number[]` to `LeagueConfig` type
- Update `DEFAULT_LEAGUES` entry with EPL tag: `polymarketTagIds: [82]`

### 3. Rewrite market discovery

**`src/infrastructure/polymarket/market-discovery.ts`**

Remove:
- `FOOTBALL_SPORT_PREFIXES` constant
- `isFootballSport()` exported function
- `extractTagIds()` exported function
- `discoverFootballLeagues()` method

Add:
- `MarketDiscoveryConfig` type: `{ leagues: Array<{ polymarketTagIds: number[] }>; lookAheadDays: number }`
- `collectTagIds(config)` — reads tag IDs directly from league config, deduplicates
- Change `createMarketDiscovery(gamma)` signature to `createMarketDiscovery(gamma, config)`

Update `fetchActiveEvents(tagId, limit)`:
- Calculate date range: `start_date_min = now`, `start_date_max = now + lookAheadDays`
- Pass `start_date_min` and `start_date_max` as ISO strings to `gamma.getEvents()`
- Change sort order to `ascending: true` (nearest events first instead of furthest)

Update `discoverFootballMarkets()`:
- Call `collectTagIds(config)` instead of `discoverFootballLeagues()` → `extractTagIds()`
- Rest of deduplication logic stays the same

### 4. Update call sites

**`src/index.ts`** (line 57)

Change:
```ts
const discovery = createMarketDiscovery(gammaClient);
```
To:
```ts
const discovery = createMarketDiscovery(gammaClient, {
  leagues: DEFAULT_CONFIG.leagues,
  lookAheadDays: DEFAULT_CONFIG.fixtureLookAheadDays,
});
```

**`src/scripts/test-pipeline.ts`** (lines 30–36, 94)

- Add `polymarketTagIds` to each entry in the `LEAGUES` array:
  - Premier League: `[82]`
  - La Liga: `[306]`
  - Serie A: `[100350]`
  - Bundesliga: `[100350]`
  - Ligue 1: `[100350]`
- Update `createMarketDiscovery(gamma)` call to pass config:
  ```ts
  const discovery = createMarketDiscovery(gamma, {
    leagues: LEAGUES,
    lookAheadDays: 10,
  });
  ```

> Note: Tag IDs 306 / 100350 for non-EPL leagues are provisional — the discover-tags script (step 6) will let us verify/correct them.

### 5. Update tests

**`tests/unit/infrastructure/polymarket/market-discovery.test.ts`**

Remove:
- `isFootballSport` describe block (function deleted)
- `extractTagIds` describe block (function deleted)
- `discoverFootballLeagues` test (method deleted)
- Import of `isFootballSport` and `extractTagIds`

Update:
- `mockGammaClient` — add `getTags` mock (returns `[]`)
- All `createMarketDiscovery(gamma)` calls → `createMarketDiscovery(gamma, config)` with a test config
- Pagination test (`fetchActiveEvents`) — same logic, updated call signature
- Deduplication test (`discoverFootballMarkets`) — use config with tag IDs `[82, 100350]` instead of mock sports

Add new tests:
- **Date range params are passed** — verify `gamma.getEvents()` receives `start_date_min` and `start_date_max`
- **Only configured tag IDs are queried** — verify `getEvents` is called exactly once per unique tag ID from config, no `/sports` calls

### 6. Add diagnostic script

**`src/scripts/discover-tags.ts`**

New script that:
- Calls `gamma.getSports()` and `gamma.getTags()`
- Prints all sports with their tags
- Prints all tags with their labels
- Useful for discovering/verifying which tag IDs correspond to which leagues

**`package.json`**

Add script:
```json
"discover:tags": "bun run src/scripts/discover-tags.ts"
```

### 7. Update BUGS.md

Mark the first bug (sport tag filtering) as resolved:
```
- [x] Improve Polymarket sport tag filtering — ...
```

---

## Files touched

| File | Action |
|------|--------|
| `src/infrastructure/polymarket/types.ts` | Edit — add `GammaTag`, extend `GammaEventParams` |
| `src/infrastructure/polymarket/gamma-client.ts` | Edit — add `getTags()` |
| `src/orchestrator/config.ts` | Edit — add `polymarketTagIds` to `LeagueConfig` |
| `src/infrastructure/polymarket/market-discovery.ts` | Rewrite — config-driven tags + date filtering |
| `src/index.ts` | Edit — pass config to `createMarketDiscovery` |
| `src/scripts/test-pipeline.ts` | Edit — add tag IDs, pass config |
| `tests/unit/infrastructure/polymarket/market-discovery.test.ts` | Rewrite — match new API |
| `src/scripts/discover-tags.ts` | New — diagnostic script |
| `package.json` | Edit — add `discover:tags` script |
| `BUGS.md` | Edit — mark bug resolved |

## Verification

1. `bun run discover:tags` — confirm tag mappings
2. `bun test` — all tests pass
3. `bun run typecheck` — no type errors
4. `bun run test:pipeline` — verify only EPL events come back (not esports)
