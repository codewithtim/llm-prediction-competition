# Plan: Split Discovery Pipeline into Fixtures + Market Refresh

**Date:** 2026-03-04
**Status:** Complete

---

## Overview

The current discovery pipeline runs as a single unit every 7 days, fetching both fixtures from API-Football and markets from Polymarket's Gamma API. Market data (liquidity, prices, active/closed status) changes much more frequently than fixture data. This plan splits the pipeline so market refresh can run on a shorter interval while fixture discovery stays infrequent.

---

## Approach

Create a new **market refresh pipeline** that runs independently on its own interval. Keep the existing discovery pipeline unchanged for fixture fetching. The market refresh pipeline does the market-only parts: fetch events from Gamma, match against fixtures already in the DB, and bulk upsert markets.

### Why not refactor the existing pipeline?

The existing discovery pipeline works correctly and has tests. Splitting it internally would risk breaking the fixture discovery flow and add complexity. A new pipeline that coexists is the cleanest approach — the discovery pipeline continues to work as-is (weekly fixtures + initial markets), while the market refresh pipeline runs more frequently to keep market data fresh.

### Overlap handling

Both pipelines will upsert markets. This is fine because `bulkUpsert` uses `ON CONFLICT DO UPDATE` — whichever runs last wins with the freshest data. No race conditions since upserts are idempotent.

### Trade-offs

- **Slight duplication:** The weekly discovery pipeline still upserts markets too. This is harmless (idempotent upserts) and means we don't need to touch the working discovery pipeline at all.
- **Extra Gamma API calls:** Market refresh makes additional Gamma API calls. Gamma has no rate limits so this is fine.
- **DB fixtures for matching:** Market refresh matches against DB fixtures (via `findScheduledUpcoming()`), not freshly-fetched ones. This means new markets can only be linked to fixtures that have already been discovered. Since fixture discovery runs first on startup, this is a non-issue in practice.

---

## Changes Required

### New file: `src/orchestrator/market-refresh-pipeline.ts`

New pipeline that fetches markets from Gamma, matches against DB fixtures, and upserts.

```typescript
export type MarketRefreshPipelineDeps = {
  discovery: MarketDiscovery;
  marketsRepo: ReturnType<typeof marketsRepoFactory>;
  fixturesRepo: ReturnType<typeof fixturesRepoFactory>;
};

export type MarketRefreshPipelineResult = {
  eventsDiscovered: number;
  marketsUpserted: number;
  errors: string[];
};

export function createMarketRefreshPipeline(deps: MarketRefreshPipelineDeps) {
  const { discovery, marketsRepo, fixturesRepo } = deps;

  return {
    async run(): Promise<MarketRefreshPipelineResult> {
      // 1. Fetch events from Gamma
      // 2. Load scheduled fixtures from DB
      // 3. matchEventsToFixtures()
      // 4. Bulk upsert markets (matched with fixtureId, unmatched with null)
    },
  };
}
```

The `run()` method reuses existing building blocks:
- `discovery.discoverFootballMarkets()` — same Gamma fetch as the discovery pipeline
- `fixturesRepo.findScheduledUpcoming()` — loads scheduled fixtures from DB
- `matchEventsToFixtures()` — same matching logic
- `marketsRepo.bulkUpsert()` — same upsert

The market-to-DB-row conversion (`marketToDbRow`) is currently a private function in `discovery-pipeline.ts`. We'll extract it to a shared location or duplicate it (it's 20 lines of straightforward mapping).

### `src/orchestrator/config.ts`

Add `marketRefreshIntervalMs` to `PipelineConfig`:

```typescript
export type PipelineConfig = {
  // ... existing fields ...
  marketRefreshIntervalMs: number;
  marketRefreshDelayMs?: number;
};
```

Default: 4 hours (reasonable for liquidity/price updates without being excessive).

```typescript
export const DEFAULT_CONFIG: PipelineConfig = {
  // ... existing ...
  marketRefreshIntervalMs: 4 * 60 * 60 * 1000, // 4 hours
};
```

### `src/orchestrator/scheduler.ts`

Add the market refresh pipeline to the scheduler:

1. Add `marketRefreshPipeline` to `SchedulerDeps`
2. Add `marketRefreshTimer`, `marketRefreshDelayTimer`, `marketRefreshRunning` variables
3. Add `runMarketRefresh()` function (same pattern as the other run functions)
4. Wire it up in `start()` and `stop()`

The scheduler already has an established pattern for each pipeline (overlap guard, delay support, timer cleanup). Market refresh follows the same pattern exactly.

### `src/index.ts`

Wire up the new pipeline:

```typescript
import { createMarketRefreshPipeline } from "./orchestrator/market-refresh-pipeline.ts";

const marketRefreshPipeline = createMarketRefreshPipeline({
  discovery,
  marketsRepo: markets,
  fixturesRepo: fixtures,
});

const scheduler = createScheduler({
  // ... existing ...
  marketRefreshPipeline,
});
```

### `src/orchestrator/discovery-pipeline.ts`

Extract the `marketToDbRow` helper so the market refresh pipeline can reuse it. Two options:

**Option A (preferred):** Export `marketToDbRow` from `discovery-pipeline.ts` — it's already there, just not exported.

**Option B:** Move it to a shared `src/orchestrator/mappers.ts` file.

Option A is simpler and avoids creating a new file for one function.

### Test files

**New: `tests/unit/orchestrator/market-refresh-pipeline.test.ts`**

Test cases:
- Fetches events and upserts markets
- Matches markets to DB fixtures by gameId/team name
- Handles empty events gracefully
- Handles Gamma fetch failure gracefully
- Handles empty fixtures from DB (markets still upserted with null fixtureId)

**Modified: `tests/unit/orchestrator/scheduler.test.ts`**

Add tests:
- `start()` runs market refresh immediately
- `stop()` clears market refresh timer
- Overlap guard prevents concurrent market refresh runs
- Market refresh delay works when `marketRefreshDelayMs` is set

The test helper `buildDeps` needs a `marketRefreshPipeline` mock added.

---

## Test Plan

| Test | File | Asserts |
|------|------|---------|
| Market refresh fetches and upserts | `market-refresh-pipeline.test.ts` | `discovery.discoverFootballMarkets` called, `marketsRepo.bulkUpsert` called with correct rows |
| Market refresh matches against DB fixtures | `market-refresh-pipeline.test.ts` | Markets get correct `fixtureId` from DB fixture match |
| Market refresh handles Gamma failure | `market-refresh-pipeline.test.ts` | Returns error in result, doesn't throw |
| Market refresh handles no fixtures | `market-refresh-pipeline.test.ts` | Markets upserted with null fixtureId |
| Scheduler runs market refresh immediately | `scheduler.test.ts` | `marketRefreshPipeline.run` called after `start()` |
| Scheduler stops market refresh timer | `scheduler.test.ts` | No additional calls after `stop()` |
| Scheduler overlap guard for market refresh | `scheduler.test.ts` | Slow run prevents concurrent execution |

---

## Task Breakdown

- [x] Export `marketToDbRow` from `src/orchestrator/discovery-pipeline.ts`
- [x] Create `src/orchestrator/market-refresh-pipeline.ts` with `createMarketRefreshPipeline()`
- [x] Add `marketRefreshIntervalMs` and `marketRefreshDelayMs` to `PipelineConfig` in `src/orchestrator/config.ts`
- [x] Add `marketRefreshPipeline` to `SchedulerDeps`, add `runMarketRefresh()`, wire into `start()` and `stop()` in `src/orchestrator/scheduler.ts`
- [x] Wire up `marketRefreshPipeline` in `src/index.ts`
- [x] Create `tests/unit/orchestrator/market-refresh-pipeline.test.ts`
- [x] Update `tests/unit/orchestrator/scheduler.test.ts` — add mock, update `buildDeps`, add market refresh scheduler tests
- [x] Run `bun test` to verify all tests pass
