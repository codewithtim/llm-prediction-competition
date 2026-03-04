# Review: Split Discovery Pipeline (Market Refresh)

**Reviewed:** 2026-03-04
**Reviewer:** Claude (Principal Engineer Review)
**Plan:** [plan.md](./plan.md)
**Verdict:** CHANGES REQUIRED

## Summary

The goal was to split market refresh into its own pipeline running on a shorter interval than fixture discovery. The market refresh pipeline is well-implemented with good error handling and clean reuse of existing building blocks. However, the second commit (77290bb) introduced TypeScript compilation errors while extracting shared converters — `FixtureRow` and `MarketRow` types were removed from `prediction-pipeline.ts` but are still referenced. This is a blocking issue.

## Findings

### Architecture & Design — Pass

The implementation matches the plan's intent and makes a good decision: instead of the plan's preferred Option A (export from discovery-pipeline), the code goes with a dedicated `src/orchestrator/converters.ts` module. This is cleaner than either option in the plan since it centralises all row↔domain converters. Domain boundaries are respected — converters import domain types and schema types, which is appropriate for an orchestrator-layer module.

The `marketRefreshPipeline` is correctly wired as optional (`?`) in `SchedulerDeps`, following the same pattern as `orderConfirmationService` and `betRetryService`.

Data flows correctly: orchestrator → domain services (matching) → repositories (upsert).

### TypeScript & Type Safety — Fail

Two TypeScript compilation errors introduced in commit 77290bb:

- **`src/orchestrator/prediction-pipeline.ts:63`** — `MarketRow` is undefined. The type alias was removed (along with its schema import) but the reference in `PreFetchedFixtureData` remains.
- **`src/orchestrator/prediction-pipeline.ts:201`** — `FixtureRow` is undefined. Same issue — type alias removed, usage remains in `gatherFixtureStats` parameter.

These compile errors are confirmed via `tsc --noEmit`. They're masked at runtime because Bun strips types without checking them, and `bun test` doesn't run type checking.

The `FixtureRow` and `MarketRow` types exist in `converters.ts` (lines 9-10) but are not exported.

Additionally, there's a remaining private `marketToDbRow` in `prediction-pipeline.ts:104-123` with a different signature (no `fixtureId` parameter). This is used for the single-market odds refresh upsert (`marketsRepo.upsert()` at line 342). It's functionally correct but creates a subtle divergence from the shared version in converters.ts.

### Data Validation & Zod — Pass

No new external data boundaries introduced. The pipeline reuses existing validated paths (`discoverFootballMarkets`, `findScheduledUpcoming`, `bulkUpsert`).

### Database & Drizzle ORM — Pass

Queries use Drizzle's query builder via existing repository methods. The `bulkUpsert` uses `ON CONFLICT DO UPDATE` which is correctly idempotent. No N+1 patterns — fixtures are batch-loaded via `findScheduledUpcoming()`.

### Security — Pass

No new secret handling. No user input processing. The pipeline operates entirely with internal data flows.

### Testing — Pass

Good test coverage for the market refresh pipeline:
- Happy path (fetch + upsert)
- Fixture matching by gameId with assertion on the actual `fixtureId` value passed to `bulkUpsert`
- Empty events
- Gamma fetch failure (returns error, doesn't throw)
- No fixtures in DB (markets get null fixtureId)

Scheduler tests cover: immediate run, stop clears timer, overlap guard, delay support. All follow established patterns.

The `as any` casts in test `buildDeps` are acceptable — the mocks implement exactly the methods the pipeline calls. Using `as any` here is the project convention for mocking repos.

Minor: tests don't reset mocks between tests with `beforeEach`, but since each test creates fresh `buildDeps()` instances this is fine.

### Error Handling & Resilience — Concern

The pipeline uses `Promise.allSettled` for parallel Gamma + fixture fetches, which is good. Gamma failure correctly short-circuits with an error in the result.

However, at `src/orchestrator/market-refresh-pipeline.ts:52-53`, a fixtures DB fetch failure is silently swallowed — no error is logged and no error is added to the result:

```typescript
const fixtures =
  dbFixtures.status === "fulfilled" ? dbFixtures.value.map(dbRowToFixture) : [];
```

If `findScheduledUpcoming()` throws (e.g., DB connection failure), the pipeline silently continues with zero fixtures, upserts all markets with `null` fixtureIds, and reports success. A warning log should be added so operators can see when fixture matching was skipped.

### Code Quality & Conventions — Pass

Clean extraction of shared converters. `collectMarketRows` neatly deduplicates the matched/unmatched market collection logic that was previously inline. Functions are small and focused. Naming is consistent with existing codebase conventions.

The `fix-migration-journal.ts` changes are cosmetic lint fixes (`"fs"` → `"node:fs"`, non-null assertions → `as` casts, template literal for trailing newline). All fine.

### Operational Concerns — Concern

**Interval mismatch with plan:** The plan specifies a 4-hour market refresh interval, but the implementation defaults to 15 minutes (`config.ts:58`). This is likely a deliberate decision to keep market data fresher, but it means 96 Gamma API calls/day per league vs the planned 6. Since Gamma has no rate limits this isn't a problem, but it's worth documenting the rationale.

Logging is good — structured JSON with counts at each step, duration tracking in the scheduler.

## What's Done Well

- **`src/orchestrator/converters.ts`** — Clean extraction that goes further than the plan. Instead of just exporting from discovery-pipeline, a dedicated module centralises all row↔domain converters. `dbRowToFixture`, `dbRowToMarket`, `marketToDbRow`, and `collectMarketRows` are all properly shared now.
- **`src/orchestrator/market-refresh-pipeline.ts`** — Compact, focused pipeline. `Promise.allSettled` for parallel fetches is a good pattern. Error results are accumulated rather than thrown.
- **Scheduler integration** — Follows the established pattern exactly: overlap guard, delay support, timer cleanup. Optional dependency via `?` operator.
- **Test coverage** — Tests verify behaviour, not implementation. The `gameId` matching test inspects actual `bulkUpsert` arguments to verify correct `fixtureId` assignment.
- **`discovery-pipeline.ts`** refactoring — The inline market collection logic was cleanly replaced with `collectMarketRows(matchResult)`, reducing 15 lines to 1.

## Must-Do Changes

These MUST be addressed before merging:

- [x] **Export `FixtureRow` and `MarketRow` from `src/orchestrator/converters.ts`** and import them in `src/orchestrator/prediction-pipeline.ts`. Currently `converters.ts:9-10` defines them as unexported `type` aliases, but `prediction-pipeline.ts:63` and `prediction-pipeline.ts:201` reference them after the local definitions were removed. This causes two `tsc` compilation errors: `TS2552: Cannot find name 'MarketRow'` and `TS2552: Cannot find name 'FixtureRow'`.

## Should-Do Changes

Recommended but not blocking:

- [x] **Log a warning when fixtures DB fetch fails** in `src/orchestrator/market-refresh-pipeline.ts:52-53`. Currently a rejected `findScheduledUpcoming()` is silently consumed. Add a `logger.warn` and optionally push to `result.errors` so operators know fixture matching was skipped.
- [x] **Consider deduplicating `marketToDbRow`** — `prediction-pipeline.ts:104-123` has a private version without `fixtureId`, while `converters.ts:50-70` has the shared version with `fixtureId`. The prediction pipeline version could call the shared one with `fixtureId: null` or a sensible default, or the shared function could make `fixtureId` optional. This would eliminate the divergence risk if the Market model gains new fields.

## Questions for the Author

- The default interval was changed from the planned 4 hours to 15 minutes. Was this intentional? If so, is there a concern about the market refresh and prediction pipeline running at the same interval and potentially competing for Gamma API calls?
