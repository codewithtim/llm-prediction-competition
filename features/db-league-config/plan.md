# Plan: Move Sports & League Configuration to Database

**Date:** 2026-03-14
**Status:** Draft

---

## Overview

Move league configuration from hardcoded `LEAGUE_CATALOG` / `DEFAULT_LEAGUES` in `src/orchestrator/config.ts` into database tables, with multi-sport support built in from the start. Two new tables: `sports` (sport-level config like Polymarket tag IDs) and `leagues` (leagues/competitions within a sport). Each has an `enabled` flag. All consumers read active leagues from the database instead of static config.

---

## Approach

Add a `sports` table and a `leagues` table. `leagues` references `sports` via a `sport` column (text slug, e.g. `"football"`). The Polymarket tag ID (currently `SOCCER_TAG_ID = 100350`) moves to the `sports` table since it's a sport-level concern — all football leagues share the same tag.

**Key design decisions:**

1. **`sports` table** stores sport-level config: name, Polymarket tag ID, enabled flag. Keyed by slug (`"football"`, `"basketball"`, etc.).

2. **`leagues` table** stores all fields from the current `LeagueConfig` plus `sport` (FK to sports), `tier`, and `enabled`. The `tier` column absorbs the current `LEAGUE_TIERS` mapping.

3. **`PipelineConfig.leagues` stays as a field** but is populated dynamically from the DB at startup. Consumers still receive `LeagueConfig[]` — the source changes from hardcoded to DB.

4. **Discovery and prediction pipelines reload leagues from the repo** at the start of each run, so toggling takes effect on the next cycle without restart.

5. **Market discovery receives tag IDs from the sports table** instead of the hardcoded `SOCCER_TAG_ID` constant. The `MarketDiscoveryConfig.soccerTagId` becomes a generic `tagId` (or is fetched per-sport).

6. **`LEAGUE_CATALOG` remains as a read-only reference** for scripts. `DEFAULT_LEAGUES`, `LEAGUE_TIERS`, `DEFAULT_LEAGUE_TIER`, and `SOCCER_TAG_ID` are all removed.

7. **Current code stays football-specific in behaviour** — engines, features, stats APIs are all football. But the data model is now sport-aware, so adding a second sport later means adding rows to `sports` and `leagues`, plus a new engine/stats client for that sport.

### Trade-offs

- **Extra DB query per pipeline run** — one `SELECT` for enabled sports + leagues. Negligible vs API calls.
- **Migration required** — single deployment, low risk.
- **`LEAGUE_CATALOG` remains in code** — reference for seeding/scripts. Could become stale, acceptable for now.
- **`sports` table is small** — could be just a column on `leagues`. But a separate table is cleaner: the Polymarket tag ID is per-sport, not per-league, and it avoids denormalising the tag ID across every league row.

---

## Changes Required

### `src/database/schema.ts`

Add two tables:

```typescript
export const sports = sqliteTable("sports", {
  slug: text("slug").primaryKey(), // e.g. "football", "basketball"
  name: text("name").notNull(), // e.g. "Football", "Basketball"
  polymarketTagId: integer("polymarket_tag_id"), // e.g. 100350 for soccer
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const leagues = sqliteTable("leagues", {
  id: integer("id").primaryKey(), // API-Football league ID (e.g. 39)
  sport: text("sport")
    .notNull()
    .references(() => sports.slug),
  name: text("name").notNull(),
  country: text("country").notNull(),
  type: text("type", { enum: ["cup", "league"] }).notNull(),
  polymarketSeriesSlug: text("polymarket_series_slug").notNull(),
  domesticLeagueIds: text("domestic_league_ids", { mode: "json" }).$type<number[]>(),
  tier: integer("tier").notNull().default(5),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
```

### `drizzle/0003_*.sql` (migration)

Hand-written SQL migration:

```sql
CREATE TABLE `sports` (
  `slug` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `polymarket_tag_id` integer,
  `enabled` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE TABLE `leagues` (
  `id` integer PRIMARY KEY NOT NULL,
  `sport` text NOT NULL REFERENCES `sports`(`slug`),
  `name` text NOT NULL,
  `country` text NOT NULL,
  `type` text NOT NULL,
  `polymarket_series_slug` text NOT NULL,
  `domestic_league_ids` text,
  `tier` integer NOT NULL DEFAULT 5,
  `enabled` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

-- Seed sports
INSERT INTO `sports` (`slug`, `name`, `polymarket_tag_id`, `enabled`, `created_at`, `updated_at`) VALUES
  ('football', 'Football', 100350, 1, unixepoch(), unixepoch());

-- Seed leagues (all football)
INSERT INTO `leagues` (`id`, `sport`, `name`, `country`, `type`, `polymarket_series_slug`, `domestic_league_ids`, `tier`, `enabled`, `created_at`, `updated_at`) VALUES
  (39, 'football', 'Premier League', 'England', 'league', 'premier-league', NULL, 1, 1, unixepoch(), unixepoch()),
  (2, 'football', 'Champions League', 'World', 'cup', 'ucl', '[39,140,135,78,61]', 1, 1, unixepoch(), unixepoch()),
  (140, 'football', 'La Liga', 'Spain', 'league', 'la-liga', NULL, 1, 0, unixepoch(), unixepoch()),
  (135, 'football', 'Serie A', 'Italy', 'league', 'serie-a', NULL, 1, 0, unixepoch(), unixepoch()),
  (78, 'football', 'Bundesliga', 'Germany', 'league', 'bundesliga', NULL, 1, 0, unixepoch(), unixepoch()),
  (61, 'football', 'Ligue 1', 'France', 'league', 'ligue-1', NULL, 1, 0, unixepoch(), unixepoch()),
  (40, 'football', 'Championship', 'England', 'league', 'efl-championship', NULL, 2, 1, unixepoch(), unixepoch()),
  (45, 'football', 'FA Cup', 'England', 'cup', 'fa-cup', '[39,40,41,42]', 2, 0, unixepoch(), unixepoch());
```

Enabled leagues match current `DEFAULT_LEAGUES`: Premier League (39), Champions League (2), Championship (40).

### `src/database/repositories/sports.ts` (new)

```typescript
export function sportsRepo(db: ReturnType<typeof createDb>) {
  return {
    async findEnabled(): Promise<SportRow[]> { ... },
    async findAll(): Promise<SportRow[]> { ... },
    async findBySlug(slug: string): Promise<SportRow | undefined> { ... },
    async upsert(sport: NewSport): Promise<void> { ... },
  };
}
```

### `src/database/repositories/leagues.ts` (new)

```typescript
export function leaguesRepo(db: ReturnType<typeof createDb>) {
  return {
    async findEnabled(): Promise<LeagueRow[]> { ... },
    async findEnabledBySport(sport: string): Promise<LeagueRow[]> { ... },
    async findAll(): Promise<LeagueRow[]> { ... },
    async findById(id: number): Promise<LeagueRow | undefined> { ... },
    async setEnabled(id: number, enabled: boolean): Promise<void> { ... },
    async upsert(league: NewLeague): Promise<void> { ... },
  };
}

export function toLeagueConfig(row: LeagueRow): LeagueConfig { ... }
```

### `src/orchestrator/config.ts`

- **Remove** `DEFAULT_LEAGUES`, `LEAGUE_TIERS`, `DEFAULT_LEAGUE_TIER`, `SOCCER_TAG_ID`.
- **Keep** `LEAGUE_CATALOG` as reference (update entries to include `tier` and `sport`).
- **Keep** `LeagueConfig` type — add `tier` and `sport` fields.
- **Keep** `PipelineConfig` with `leagues: LeagueConfig[]`.

Updated types:

```typescript
export type LeagueConfig = {
  id: number;
  sport: string;
  name: string;
  country: string;
  type: "cup" | "league";
  polymarketSeriesSlug: string;
  domesticLeagueIds?: number[];
  tier: number;
};
```

`LEAGUE_CATALOG` entries updated with `sport: "football"` and `tier` values.

### `src/apis/polymarket/market-discovery.ts`

Update `MarketDiscoveryConfig`:

```typescript
export type MarketDiscoveryConfig = {
  leagues: Array<{ polymarketSeriesSlug: string }>;
  tagId: number;  // was soccerTagId
  lookAheadDays: number;
};
```

Rename `soccerTagId` → `tagId` throughout. The method `discoverFootballMarkets()` keeps its name for now (it's still football-specific in behaviour), but receives the tag ID from config rather than a hardcoded constant.

### `src/orchestrator/prediction-pipeline.ts`

- Add `leaguesRepo` to `PredictionPipelineDeps`.
- At top of `run()`, load enabled leagues from DB.
- Replace `LEAGUE_TIERS[id] ?? DEFAULT_LEAGUE_TIER` with `activeLeagues.find(l => l.id === id)?.tier ?? 5`.
- Remove imports of `LEAGUE_TIERS` and `DEFAULT_LEAGUE_TIER`.

### `src/orchestrator/discovery-pipeline.ts`

- Add `leaguesRepo` to `DiscoveryPipelineDeps`.
- At top of `run()`, load enabled leagues from DB instead of `config.leagues`.
- Iterate DB-sourced leagues for fixture fetching.

### `src/index.ts`

- Create `sportsRepo` and `leaguesRepo` instances.
- Load enabled sport (football) to get Polymarket tag ID.
- Load enabled leagues at startup to populate config.
- Pass repos to pipelines.

```typescript
const sportsRepository = sportsRepo(db);
const leaguesRepository = leaguesRepo(db);

const enabledSports = await sportsRepository.findEnabled();
const footballSport = enabledSports.find(s => s.slug === "football");
const tagId = footballSport?.polymarketTagId ?? 100350;

const enabledLeagues = await leaguesRepository.findEnabled();

const discovery = createMarketDiscovery(gammaClient, {
  leagues: enabledLeagues,
  tagId,
  lookAheadDays: DEFAULT_CONFIG.fixtureLookAheadDays,
});

const config: PipelineConfig = {
  ...DEFAULT_CONFIG,
  leagues: enabledLeagues.map(toLeagueConfig),
};
```

### `src/orchestrator/scheduler.ts`

No changes needed.

### `src/orchestrator/market-refresh-pipeline.ts`

No changes needed.

### Tests to update

**`tests/unit/apis/polymarket/market-discovery.test.ts`:**
- Rename `soccerTagId` → `tagId` in test config objects.

**`tests/unit/orchestrator/pipeline.test.ts`:**
- Add `leaguesRepo` mock to `buildPredictionDeps`.
- Update assertions for tier lookups.

**`tests/unit/orchestrator/discovery-pipeline.test.ts`** (if it exists):
- Add `leaguesRepo` mock.

---

## Data & Migration

- **Two new tables:** `sports` and `leagues` — created via SQL migration.
- **Seeded data:** 1 sport (football, tag 100350), 8 leagues. 3 leagues enabled, 5 disabled.
- **No existing tables modified.** Purely additive.
- **Drizzle meta:** Update `drizzle/meta/_journal.json` with new migration entry. Generate snapshot.

---

## Test Plan

1. **Sports repository tests** (`tests/unit/database/repositories/sports.test.ts`):
   - `findEnabled` returns only enabled sports
   - `findAll` returns all sports
   - `findBySlug` returns correct sport or undefined
   - `upsert` creates/updates

2. **Leagues repository tests** (`tests/unit/database/repositories/leagues.test.ts`):
   - `findEnabled` returns only enabled leagues
   - `findEnabledBySport("football")` returns only football leagues that are enabled
   - `findAll` returns all leagues
   - `setEnabled` toggles flag
   - `upsert` creates/updates
   - `toLeagueConfig` correctly maps DB row to `LeagueConfig`

3. **Prediction pipeline tests**:
   - Mock `leaguesRepo.findEnabled()` returns expected leagues
   - `activeLeagueIds` passed to `findReadyForPrediction` matches DB leagues
   - Tier lookup uses league config from DB

4. **Discovery pipeline tests**:
   - `leaguesRepo.findEnabled()` called at start of `run()`
   - Fixtures fetched for each DB-sourced league

5. **Market discovery tests**:
   - Config uses `tagId` instead of `soccerTagId`

---

## Task Breakdown

- [x] Add `sports` and `leagues` tables to `src/database/schema.ts`
- [x] Add `sport` and `tier` fields to `LeagueConfig` type in `src/orchestrator/config.ts`
- [x] Update `LEAGUE_CATALOG` entries to include `sport: "football"` and `tier` values
- [x] Remove `LEAGUE_TIERS`, `DEFAULT_LEAGUE_TIER`, `DEFAULT_LEAGUES`, and `SOCCER_TAG_ID` from `src/orchestrator/config.ts`
- [x] Create `src/database/repositories/sports.ts` with `sportsRepo` factory
- [x] Create `src/database/repositories/leagues.ts` with `leaguesRepo` factory, `toLeagueConfig` helper
- [x] Write hand-crafted SQL migration `drizzle/0003_sports_and_leagues.sql` with CREATE TABLEs + seed INSERTs
- [x] Update drizzle meta journal (`drizzle/meta/_journal.json`) with new migration entry
- [x] Create `tests/unit/database/repositories/sports.test.ts`
- [ ] Create `tests/unit/database/repositories/leagues.test.ts`
- [x] Update `src/apis/polymarket/market-discovery.ts`: rename `soccerTagId` → `tagId` in config type and usage
- [x] Update `tests/unit/apis/polymarket/market-discovery.test.ts` for `tagId` rename
- [x] Update `src/orchestrator/prediction-pipeline.ts`: add `leaguesRepo` dep, load enabled leagues in `run()`, replace `LEAGUE_TIERS` lookup
- [x] Update `src/orchestrator/discovery-pipeline.ts`: add `leaguesRepo` dep, load enabled leagues in `run()`
- [x] Update `src/index.ts`: create repos, load enabled sports + leagues at startup, pass tag ID and repos to consumers
- [x] Update `tests/unit/orchestrator/pipeline.test.ts` for new `leaguesRepo` dep and tier changes
- [x] Update any remaining imports of `LEAGUE_TIERS` / `DEFAULT_LEAGUE_TIER` / `DEFAULT_LEAGUES` / `SOCCER_TAG_ID` across the codebase
- [x] Run `bun run typecheck`, `bun run lint`, `bun run test` — fix any failures
