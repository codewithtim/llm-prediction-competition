# Pipeline Split: Discovery + Prediction — Plan

## Context

The current single `pipeline.ts` runs everything in one `runPredictions()` call — discovery, DB persistence, matching, engine execution, odds refresh, and betting. Two problems:

1. **Predictions lost when bets are skipped** — predictions are only saved to DB when bet status is `placed` or `dry_run` (pipeline.ts L373-392). When a bet is skipped (no wallet, duplicate, exposure limit), the engine's analysis is thrown away.
2. **Engines run on stale odds** — odds are refreshed per-prediction at L336-360, but engines already ran at L314 using old prices from discovery. The engine decides on stale prices; only the bet placement gets fresh ones.

Additionally, mixing discovery and prediction in one function makes the pipeline hard to reason about and debug.

### Fix

Split into two independent pipelines that communicate through the database:

- **Discovery pipeline** — fetches markets and fixtures from external APIs, matches them, writes everything to DB
- **Prediction pipeline** — reads from DB, refreshes odds, runs engines with fresh prices, always saves predictions

---

## Architecture

```
Discovery Pipeline (every 30 min)          Prediction Pipeline (every 6 hours)
─────────────────────────────────          ──────────────────────────────────
1. Fetch events from Polymarket            1. Read scheduled fixtures from DB
2. Fetch fixtures from API-Football        2. Read matched markets from DB (by fixtureId)
3. Match events ↔ fixtures                 3. For each fixture + competitor:
4. Write ALL fixtures to DB                   a. Skip if prediction already exists
5. Write ALL markets to DB                    b. Refresh odds from Gamma → update market in DB
6. Matched markets get fixtureId set          c. Fetch standings + H2H
                                              d. Run engine (with fresh odds)
                                              e. ALWAYS save prediction to DB
                                              f. Attempt bet (may skip — fine)
```

The DB is the handoff point. Discovery writes, prediction reads. No in-memory cache needed.

---

## Changes

### 1. Schema: add `fixtureId` to markets table

**`src/infrastructure/database/schema.ts`**

Add a nullable `fixtureId` integer column to the `markets` table, referencing `fixtures.id`. This persists the match result from discovery so the prediction pipeline can query "give me all markets for fixture X."

Currently `markets.gameId` sometimes holds the fixture ID, but matching also uses a team-name+date fallback when `gameId` is absent. Storing the resolved `fixtureId` captures the result of both strategies.

Generate a new migration with `bun run db:generate`, apply with `bun run db:migrate`.

---

### 2. Markets repo: update upsert + add queries

**`src/infrastructure/database/repositories/markets.ts`**

- Update `upsert()` — include `fixtureId` in the `onConflictDoUpdate` set
- Add `findByFixtureId(fixtureId: number)` — returns all markets linked to a fixture (for the prediction pipeline to read)

---

### 3. Fixtures repo: add upcoming query

**`src/infrastructure/database/repositories/fixtures.ts`**

- Add `findScheduled()` — returns all fixtures with `status = 'scheduled'`

---

### 4. Discovery pipeline (new file)

**`src/orchestrator/discovery-pipeline.ts`**

**Dependencies:** `MarketDiscovery`, `FootballClient`, `marketsRepo`, `fixturesRepo`, `PipelineConfig`

**`run()` flow:**

```
1. discovery.discoverFootballMarkets() → events[]
   - On error: log, return early

2. For each league in config:
   footballClient.getFixtures({ league, season, from, to }) → fixtures[]
   - On error per league: log, continue

3. matchEventsToFixtures(events, fixtures) → matchResult

4. Upsert ALL fixtures to DB (matched + unmatched)

5. For matched fixtures:
   - For each market: set fixtureId = fixture.id, upsert to DB

6. For unmatched events:
   - For each market: upsert to DB with fixtureId = null

7. Return DiscoveryPipelineResult
```

**Return type:**
```typescript
type DiscoveryPipelineResult = {
  eventsDiscovered: number;
  fixturesFetched: number;
  fixturesMatched: number;
  marketsUpserted: number;
  fixturesUpserted: number;
  errors: string[];
};
```

**Reuses:**
- `matchEventsToFixtures` from `src/domain/services/market-matching.ts`
- `mapApiFixtureToFixture` from `src/infrastructure/sports-data/mappers.ts`
- `marketToDbRow`, `fixtureToDbRow` helpers (move from current pipeline.ts)

---

### 5. Prediction pipeline (new file)

**`src/orchestrator/prediction-pipeline.ts`**

**Dependencies:** `GammaClient`, `FootballClient`, `CompetitorRegistry`, `BettingService`, `marketsRepo`, `fixturesRepo`, `predictionsRepo`, `PipelineConfig`

Needs helper functions to map DB rows back to domain models:
- `dbRowToMarket(row)` → `Market` (DB columns → domain model)
- `dbRowToFixture(row)` → `Fixture` (flat DB columns → nested league/team objects)

**`run()` flow:**

```
1. fixturesRepo.findScheduled() → fixtureRows[]
   - Map each to Fixture domain model

2. For each fixture:
   a. marketsRepo.findByFixtureId(fixture.id) → marketRows[]
      - Skip if no markets

   b. Refresh odds for each market:
      - gammaClient.getMarketById(market.id) → freshGamma
      - Map to Market domain model
      - marketsRepo.upsert(freshMarket) — update DB with fresh odds
      - On error: warn, keep existing market data

   c. Build MarketContext[] from refreshed markets

   d. Fetch standings:
      - footballClient.getStandings(league.id, league.season)
      - Find home + away standings
      - Skip fixture if standings not found

   e. Fetch H2H:
      - footballClient.getHeadToHead(homeTeamId, awayTeamId)

   f. Build Statistics object (with fresh odds)

   g. engines = registry.getAll()
      runAllEngines(engines, statistics) → engineResults[]

   h. For each engine result:
      - If engine error: log, continue
      - For each prediction:
        i.  Check: predictionsRepo.findByFixtureAndCompetitor(fixtureId, competitorId)
            - If predictions exist for this fixture+competitor: skip
        ii. ALWAYS save prediction to DB via predictionsRepo.create()
        iii. Attempt bet via bettingService.placeBet()
             - Track: placed / dry_run / skipped

3. Return PredictionPipelineResult
```

**Return type:**
```typescript
type PredictionPipelineResult = {
  fixturesProcessed: number;
  predictionsGenerated: number;
  betsPlaced: number;
  betsDryRun: number;
  betsSkipped: number;
  oddsRefreshed: number;
  oddsRefreshFailed: number;
  errors: string[];
};
```

**Key differences from current pipeline.ts:**
- Reads fixtures/markets from DB instead of in-memory discovery results
- Refreshes odds BEFORE running engines (engines get fresh prices)
- Saves predictions unconditionally (not gated on bet outcome)
- Skips fixtures where competitor already has predictions (idempotent)

**Reuses:**
- `buildMarketContext` helper (move from current pipeline.ts)
- `runAllEngines` from `src/engine/runner.ts`
- `mapStandingToTeamStats`, `mapH2hFixturesToH2H` from `src/infrastructure/sports-data/mappers.ts`
- `mapGammaMarketToMarket` from `src/infrastructure/polymarket/mappers.ts`

---

### 6. Config: add discovery interval

**`src/orchestrator/config.ts`**

Add `discoveryIntervalMs` to `PipelineConfig`, default `30 * 60 * 1000` (30 minutes).

---

### 7. Scheduler: three independent loops

**`src/orchestrator/scheduler.ts`**

Update to manage three loops:
- **Discovery**: every `discoveryIntervalMs` (30 min)
- **Prediction**: every `predictionIntervalMs` (6 hours)
- **Settlement**: every `settlementIntervalMs` (2 hours, unchanged)

Each gets its own overlap-prevention flag (`discoveryRunning`, `predictionRunning`, `settlementRunning`). Same pattern as current scheduler, just one more loop.

The scheduler needs to accept the two new pipeline objects + settlement service, rather than a single `pipeline` object.

---

### 8. Entry point: wire up new pipelines

**`src/index.ts`**

- Create `discoveryPipeline` with: `discovery`, `footballClient`, `marketsRepo`, `fixturesRepo`, `config`
- Create `predictionPipeline` with: `gammaClient`, `footballClient`, `registry`, `bettingService`, `marketsRepo`, `fixturesRepo`, `predictionsRepo`, `config`
- Pass both pipelines + `settlementService` to scheduler

---

### 9. Delete old files

- **`src/orchestrator/pipeline.ts`** — replaced by the two new pipeline files
- **`src/orchestrator/discovery-cache.ts`** — no longer needed (DB is the source of truth)

---

## Files Summary

| File | Action |
|------|--------|
| `src/infrastructure/database/schema.ts` | Edit — add `fixtureId` to markets |
| `src/infrastructure/database/repositories/markets.ts` | Edit — update upsert, add `findByFixtureId` |
| `src/infrastructure/database/repositories/fixtures.ts` | Edit — add `findScheduled` |
| `src/orchestrator/discovery-pipeline.ts` | **New** |
| `src/orchestrator/prediction-pipeline.ts` | **New** |
| `src/orchestrator/config.ts` | Edit — add `discoveryIntervalMs` |
| `src/orchestrator/scheduler.ts` | Edit — three loops |
| `src/index.ts` | Edit — wire up both pipelines |
| `src/orchestrator/pipeline.ts` | **Delete** |
| `src/orchestrator/discovery-cache.ts` | **Delete** |
| New drizzle migration | Auto-generated |

## Not Changed

- `src/domain/services/betting.ts` — bet placement logic unchanged
- `src/domain/services/settlement.ts` — settlement unchanged
- `src/domain/services/market-matching.ts` — matching logic reused as-is
- `src/engine/runner.ts` — engine runner unchanged
- `src/competitors/` — competitor loading unchanged

---

## Verification

1. `bun run db:generate` — generates migration for `fixtureId` column
2. `bun run db:migrate` — applies migration
3. `bun run typecheck` — no type errors
4. `bun run start` — all three loops run on their intervals
5. After discovery runs: `SELECT COUNT(*) FROM markets` and `SELECT COUNT(*) FROM fixtures` show rows; matched markets have `fixture_id` set
6. After prediction runs: `SELECT COUNT(*) FROM predictions` shows predictions even when bets were skipped
7. Run prediction pipeline twice: second run skips fixtures where competitor already has predictions
