# Plan: Fixture Scheduling — Weekly Discovery, Status Tracking, and Prediction Lead Time

**Date:** 2026-03-03
**Status:** Draft

---

## Overview

The system currently runs the full discovery pipeline every 30 minutes and predictions every 6 hours for all scheduled fixtures regardless of kickoff time. This is wasteful — fixtures and Polymarket markets don't change that frequently, but fixture statuses (in play → finished) do need timely updates. Meanwhile, injuries and confirmed lineups only appear ~30 minutes before kickoff, so running predictions hours early wastes API calls on incomplete data. This plan restructures the scheduling into three distinct concerns: infrequent discovery, targeted fixture status tracking, and kickoff-aware prediction timing.

---

## Approach

Split the current monolithic "discovery every 30 minutes" into three independent cadences:

1. **Weekly discovery** — fetch fixtures and Polymarket markets once per week. Premier League fixtures are known well in advance. Polymarket markets are created days ahead. Running this weekly is sufficient and reduces API calls dramatically.

2. **Fixture status pipeline (new)** — a lightweight pipeline that runs every 15 minutes and only queries API-Football for fixtures that need a status update: scheduled fixtures whose kickoff has passed, and in-progress fixtures waiting to be marked finished. Each check is a single API call per fixture (`/fixtures?id=<id>`), not a full league query.

3. **Prediction lead time** — the prediction pipeline runs frequently (every 15 minutes) but only processes fixtures within 30 minutes of kickoff. This ensures injuries and lineups are available when the engine runs. Fixtures further out are ignored until they enter the 30-minute window.

### Why this structure

**Weekly discovery is safe because the data is stable.** Premier League fixtures are scheduled weeks in advance. Polymarket markets for those fixtures are created days before kickoff. A weekly fetch (with a 14-day lookahead) ensures we always have at least 7 days of buffer.

**The fixture status pipeline replaces an accidental side-effect.** Currently, fixture statuses get updated because the full discovery runs every 30 minutes and the `bulkUpsert` overwrites the status. That's expensive — it re-fetches all markets from Polymarket and all fixtures from API-Football just to update a few statuses. The new pipeline does targeted single-fixture lookups.

**Prediction lead time matches data availability.** API-Football publishes confirmed lineups and late injury updates ~30 minutes before kickoff. Predicting earlier means the engine works with incomplete data (no confirmed lineup, potentially missing last-minute injuries). By waiting until the 30-minute window, every prediction has the best available data.

### Trade-offs

- **Weekly discovery could miss mid-week fixture additions.** If a fixture is rescheduled or a new Polymarket market appears between discovery runs, we won't see it until the next weekly run. Mitigation: the 14-day lookahead provides overlap, and Premier League rescheduling is rare. If needed, discovery can be triggered manually.
- **15-minute prediction interval means slight imprecision.** A fixture at 8:00pm could be predicted anywhere between 7:30pm and 7:15pm depending on when the interval fires. This is acceptable — the 30-minute window is approximate anyway.
- **More moving parts.** Adding a third pipeline (fixture status) adds complexity to the scheduler. However, each pipeline has a single clear responsibility, which is easier to reason about than the current "discovery does everything" approach.
- **In-progress fixture status checks consume API-Football calls.** Each in-progress fixture costs 1 API call per 15-minute interval. A typical Premier League matchday has 2–3 concurrent matches, so this is ~6–9 calls over a 45-minute window per match. Negligible.

---

## Changes Required

### `src/orchestrator/config.ts`

Add `fixtureStatusIntervalMs` and `predictionLeadTimeMs` to the config type. Update default intervals.

```typescript
export type PipelineConfig = {
  leagues: LeagueConfig[];
  season?: number;
  fixtureLookAheadDays: number;
  discoveryIntervalMs: number;
  predictionIntervalMs: number;
  settlementIntervalMs: number;
  fixtureStatusIntervalMs: number;
  predictionLeadTimeMs: number;
  discoveryDelayMs?: number;
  predictionDelayMs?: number;
  settlementDelayMs?: number;
  betting: BettingConfig;
  orderConfirmation: OrderConfirmationConfig;
  retry: RetryConfig;
};

export const DEFAULT_CONFIG: PipelineConfig = {
  leagues: DEFAULT_LEAGUES,
  fixtureLookAheadDays: 14, // was 7 — wider window since discovery is weekly
  discoveryIntervalMs: 7 * 24 * 60 * 60 * 1000, // was 30 min — now weekly
  predictionIntervalMs: 15 * 60 * 1000, // was 6 hours — now 15 min (filtered by lead time)
  settlementIntervalMs: 2 * 60 * 60 * 1000, // unchanged
  fixtureStatusIntervalMs: 15 * 60 * 1000, // new — 15 min
  predictionLeadTimeMs: 30 * 60 * 1000, // new — 30 min before kickoff
  predictionDelayMs: 30_000,
  // ... rest unchanged
};
```

### `src/infrastructure/database/repositories/fixtures.ts`

Add three new methods. The date comparisons need careful handling because the `date` column stores ISO 8601 strings (e.g. `"2026-03-05T20:00:00Z"`) and `new Date().toISOString()` includes milliseconds (e.g. `"2026-03-05T20:00:00.000Z"`). A helper normalises both sides to the same format.

```typescript
import { and, eq, lte, gt, or, sql } from "drizzle-orm";

function toISONoMs(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// Fixtures within `leadTimeMs` of kickoff (for prediction pipeline)
async findReadyForPrediction(leadTimeMs: number) {
  const now = toISONoMs(new Date());
  const cutoff = toISONoMs(new Date(Date.now() + leadTimeMs));
  return db
    .select()
    .from(fixtures)
    .where(
      and(
        eq(fixtures.status, "scheduled"),
        lte(fixtures.date, cutoff),
        gt(fixtures.date, now),
      ),
    )
    .all();
},

// Fixtures that need a status check from API-Football
async findNeedingStatusUpdate() {
  const now = toISONoMs(new Date());
  return db
    .select()
    .from(fixtures)
    .where(
      or(
        and(eq(fixtures.status, "scheduled"), lte(fixtures.date, now)),
        eq(fixtures.status, "in_progress"),
      ),
    )
    .all();
},

// Targeted status update without needing the full fixture insert shape
async updateStatus(
  id: number,
  status: "scheduled" | "in_progress" | "finished" | "postponed" | "cancelled",
) {
  return db
    .update(fixtures)
    .set({ status, updatedAt: new Date() })
    .where(eq(fixtures.id, id))
    .run();
},
```

The existing `findScheduledUpcoming()` method is left unchanged — it's still valid for getting all scheduled fixtures for general-purpose queries.

### `src/orchestrator/fixture-status-pipeline.ts` (new file)

A lightweight pipeline that checks API-Football for the latest status of fixtures that have kicked off or are in play.

```typescript
import type { fixturesRepo as fixturesRepoFactory } from "../infrastructure/database/repositories/fixtures.ts";
import type { FootballClient } from "../infrastructure/sports-data/client.ts";
import { mapFixtureStatus } from "../infrastructure/sports-data/mappers.ts";
import { logger } from "../shared/logger.ts";

export type FixtureStatusPipelineResult = {
  fixturesChecked: number;
  statusesUpdated: number;
  errors: string[];
};

export type FixtureStatusPipelineDeps = {
  footballClient: FootballClient;
  fixturesRepo: ReturnType<typeof fixturesRepoFactory>;
};

export function createFixtureStatusPipeline(deps: FixtureStatusPipelineDeps) {
  const { footballClient, fixturesRepo } = deps;

  return {
    async run(): Promise<FixtureStatusPipelineResult> {
      const result = { fixturesChecked: 0, statusesUpdated: 0, errors: [] };

      const rows = await fixturesRepo.findNeedingStatusUpdate();
      // ... for each row: fetch status, compare, update if changed
    },
  };
}

export type FixtureStatusPipeline = ReturnType<typeof createFixtureStatusPipeline>;
```

For each fixture row:
1. Call `footballClient.getFixtures({ id: row.id })` — single fixture lookup.
2. Map the API status with `mapFixtureStatus(apiFixture.fixture.status.short)`.
3. If the new status differs from the stored status, call `fixturesRepo.updateStatus(row.id, newStatus)`.
4. Log status transitions for observability.
5. Catch errors per-fixture so one failure doesn't abort the whole run.

### `src/orchestrator/scheduler.ts`

Add `fixtureStatusPipeline` to deps and wire its timer with the same overlap-prevention pattern used by the other pipelines.

```typescript
export type SchedulerDeps = {
  discoveryPipeline: DiscoveryPipeline;
  predictionPipeline: PredictionPipeline;
  settlementService: SettlementService;
  fixtureStatusPipeline: FixtureStatusPipeline;
  orderConfirmationService?: OrderConfirmationService;
  betRetryService?: BetRetryService;
  config: PipelineConfig;
};
```

In `start()`:
- Run `fixtureStatusPipeline.run()` immediately, then on `config.fixtureStatusIntervalMs` interval.
- Add `fixtureStatusRunning` guard and `fixtureStatusTimer`.

In `stop()`:
- Clear the new timer.

### `src/orchestrator/prediction-pipeline.ts`

One line change in `run()` — replace `findScheduledUpcoming()` with `findReadyForPrediction()`:

```typescript
// Before:
const fixtureRows = await fixturesRepo.findScheduledUpcoming();

// After:
const fixtureRows = await fixturesRepo.findReadyForPrediction(config.predictionLeadTimeMs);
```

The rest of the pipeline is unchanged. Fixtures outside the 30-minute window simply won't appear in the query results.

### `src/index.ts`

Create and wire the fixture status pipeline:

```typescript
import { createFixtureStatusPipeline } from "./orchestrator/fixture-status-pipeline.ts";

const fixtureStatusPipeline = createFixtureStatusPipeline({
  footballClient,
  fixturesRepo: fixtures,
});

const scheduler = createScheduler({
  discoveryPipeline,
  predictionPipeline,
  settlementService,
  fixtureStatusPipeline,
  orderConfirmationService,
  betRetryService,
  config: DEFAULT_CONFIG,
});
```

---

## Data & Migration

No schema changes. No migration needed. The `fixtures` table already has the `status` and `date` columns this plan uses. The new repository methods are read-only queries and a targeted update.

---

## Test Plan

### Fixtures repository tests (`tests/unit/infrastructure/database/repositories/fixtures.test.ts`)

1. **`findReadyForPrediction` returns fixtures within lead time** — Insert a fixture with date 15 minutes from now (status "scheduled"). Call with 30-minute lead time. Verify it's returned.

2. **`findReadyForPrediction` excludes fixtures too far ahead** — Insert a fixture with date 2 hours from now. Call with 30-minute lead time. Verify it's NOT returned.

3. **`findReadyForPrediction` excludes past fixtures** — Insert a fixture with date 1 hour in the past. Call with 30-minute lead time. Verify it's NOT returned.

4. **`findReadyForPrediction` excludes non-scheduled fixtures** — Insert an "in_progress" fixture with date 15 minutes from now. Verify it's NOT returned.

5. **`findNeedingStatusUpdate` returns past scheduled fixtures** — Insert a scheduled fixture with date 1 hour in the past. Verify it's returned.

6. **`findNeedingStatusUpdate` returns in-progress fixtures** — Insert an in_progress fixture. Verify it's returned.

7. **`findNeedingStatusUpdate` excludes finished/cancelled/postponed** — Insert fixtures with these statuses and past dates. Verify none are returned.

8. **`findNeedingStatusUpdate` excludes future scheduled fixtures** — Insert a scheduled fixture with date 2 hours from now. Verify it's NOT returned.

9. **`updateStatus` updates status and updatedAt** — Insert a fixture, call `updateStatus`, verify the new status and that `updatedAt` changed.

### Fixture status pipeline tests (`tests/unit/orchestrator/fixture-status-pipeline.test.ts`)

10. **Updates scheduled fixture to in_progress when API reports 1H** — Mock `findNeedingStatusUpdate` to return one scheduled fixture. Mock `getFixtures` to return status `1H`. Verify `updateStatus` called with "in_progress".

11. **Updates in_progress fixture to finished when API reports FT** — Mock `findNeedingStatusUpdate` to return one in_progress fixture. Mock `getFixtures` to return status `FT`. Verify `updateStatus` called with "finished".

12. **Skips update when status unchanged** — Mock API returning same status as stored. Verify `updateStatus` not called.

13. **Handles API error gracefully — continues with other fixtures** — Two fixtures, first fixture's API call throws. Verify second fixture is still processed and error is captured.

14. **Handles empty API response** — Mock `getFixtures` returning empty `response` array. Verify no error thrown, no update.

### Prediction pipeline tests (`tests/unit/orchestrator/pipeline.test.ts`)

15. **Prediction pipeline uses `findReadyForPrediction` with lead time from config** — Verify the pipeline calls `findReadyForPrediction` with `config.predictionLeadTimeMs`, not `findScheduledUpcoming`.

### Scheduler tests (`tests/unit/orchestrator/scheduler.test.ts`)

16. **Runs fixture status pipeline immediately on start** — Verify `fixtureStatusPipeline.run` is called.

17. **Overlap guard prevents concurrent fixture status runs** — Same pattern as existing overlap tests.

18. **`stop()` clears fixture status timer** — Same pattern as existing stop tests.

---

## Task Breakdown

- [x] Add `fixtureStatusIntervalMs` and `predictionLeadTimeMs` to `PipelineConfig` type in `src/orchestrator/config.ts`
- [x] Update `DEFAULT_CONFIG` intervals: discovery to 7 days, prediction to 15 min, lookahead to 14 days, add new fields
- [x] Add `toISONoMs` helper and `findReadyForPrediction(leadTimeMs)` method to `src/infrastructure/database/repositories/fixtures.ts`
- [x] Add `findNeedingStatusUpdate()` method to `src/infrastructure/database/repositories/fixtures.ts`
- [x] Add `updateStatus(id, status)` method to `src/infrastructure/database/repositories/fixtures.ts`
- [x] Create `src/orchestrator/fixture-status-pipeline.ts` with `createFixtureStatusPipeline`
- [x] Add `fixtureStatusPipeline` to `SchedulerDeps` and wire timer/overlap guard in `src/orchestrator/scheduler.ts`
- [x] Replace `findScheduledUpcoming()` with `findReadyForPrediction(config.predictionLeadTimeMs)` in `src/orchestrator/prediction-pipeline.ts`
- [x] Wire `fixtureStatusPipeline` in `src/index.ts`
- [x] Add fixtures repo tests for `findReadyForPrediction`, `findNeedingStatusUpdate`, and `updateStatus`
- [x] Add fixture status pipeline tests in `tests/unit/orchestrator/fixture-status-pipeline.test.ts`
- [x] Update prediction pipeline test to verify `findReadyForPrediction` is called instead of `findScheduledUpcoming`
- [x] Add scheduler tests for fixture status pipeline timer
- [x] Update existing scheduler tests to include `fixtureStatusPipeline` in deps
- [x] Run full test suite, type check, and lint
