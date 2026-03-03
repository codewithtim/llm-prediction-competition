# Review: Per-Fixture Tight Loop — Eliminate Odds Drift

**Reviewed:** 2026-03-03
**Reviewer:** Claude (Principal Engineer Review)
**Plan:** [features/per-fixture-tight-loop/plan.md](plan.md)
**Scope:** Commit `64ebd46` + uncommitted `/simplify` fixes (standings cache, parallelisation, stats regression fix)
**Verdict:** APPROVED WITH CHANGES

## Summary

The two-phase pipeline restructuring achieves its stated goal well: stable stats are pre-fetched in Phase 1, then a tight odds→predict→bet loop runs in Phase 2, eliminating the minutes-long odds drift window from the old pipeline. The code is clean, well-decomposed, and thoroughly tested (33 pipeline tests, 506 total). The subsequent `/simplify` fixes added a standings cache, parallelised independent API calls, and fixed a behavioral regression where enriched stats failures skipped entire fixtures. There are two must-do items — one functional concern and one operational concern — but neither is blocking in the short term.

## Findings

### Architecture & Design — Pass

The implementation matches the plan closely. The separation into `gatherFixtureStats()` (Phase 1) and `processFixture()` (Phase 2) is exactly the right level of decomposition — no over-engineering, no under-engineering. Module-level extraction of `fetchTeamSeasonStats()` and `fetchPlayerStats()` was done cleanly.

Domain boundaries are respected — the pipeline (orchestrator layer) depends on domain types and infrastructure through dependency injection. `PreFetchedFixtureData` is a sensible internal type that stays file-scoped.

The `standingsCache` is correctly placed inside the `createPredictionPipeline` closure, scoped to the pipeline instance. Good decision to use `Promise.allSettled` for parallel fetches with graceful degradation.

### TypeScript & Type Safety — Pass

- `PreFetchedFixtureData` correctly marks enriched stats as optional (`?`), matching the `Statistics` Zod schema where they're declared optional (`prediction-pipeline.ts:74-77`)
- The `unpack` helper at `prediction-pipeline.ts:321` has a well-typed generic signature
- `Awaited<ReturnType<typeof footballClient.getStandings>>` at `prediction-pipeline.ts:241` — inferred type for the cache is correct, avoids manual type duplication
- The `as EngineResult` cast at `prediction-pipeline.ts:432` is pre-existing and safe (discriminated union already checked)
- Test fix for `!` non-null assertion at `pipeline.test.ts:780` — appropriate here since the test has just triggered the call

### Data Validation & Zod — Pass

No new system boundaries introduced. The `Statistics` object is constructed from already-validated data (DB rows, mapped API responses). The `statisticsSchema` in `src/domain/contracts/statistics.ts:118-135` correctly declares enriched stats as `.optional()`, consistent with the pipeline's behavior.

### Database & Drizzle ORM — Pass

- `marketsRepo.upsert()` is used correctly for odds refresh
- `polymarketUrl` preservation (`prediction-pipeline.ts:377`) prevents the null-overwrite bug discovered earlier
- No new queries, no raw SQL, no transaction concerns

### Security — Pass

No secrets are logged. The `polymarketUrl` field is a public URL. API client usage is unchanged.

### Testing — Concern

Tests are comprehensive and well-structured. The `/simplify` test updates correctly reflect the new behavior:
- `pipeline.test.ts:994-1011` — "continues fixture when team stats API fails" (was "skips")
- `pipeline.test.ts:1014-1032` — "continues fixture when player stats API fails" (was "skips")
- `pipeline.test.ts:1101-1164` — Updated to use different leagues to test standings cache behavior correctly

**Concern:** There is no test verifying that the `standingsCache` actually deduplicates calls for same-league fixtures. The "multiple fixtures" test at `pipeline.test.ts:1211` uses fixtures with the same league but doesn't assert that `getStandings` was called only once. This is a should-do, not blocking.

### Error Handling & Resilience — Pass

Error handling is well-layered:
- Standings failure → fixture skipped (hard dependency, `prediction-pipeline.ts:275-279`)
- H2H failure → fallback to empty H2H (soft dependency, `prediction-pipeline.ts:296-300`), safe because `features.ts:27` handles `totalMatches === 0`
- Injuries failure → fallback to empty array (pre-existing, `prediction-pipeline.ts:302-311`)
- Team/player stats failure → fixture continues with `undefined` stats (new, `prediction-pipeline.ts:333-344`), safe because `Statistics` type accepts optional

Each fallback is logged with fixture context. The mutable `result` bag accumulates errors without stopping the pipeline — correct for the batch-processing pattern.

### Code Quality & Conventions — Pass

- Naming is clear and consistent: `gatherFixtureStats`, `processFixture`, `getStandingsCached`
- `marketToDbRow` is duplicated across pipelines but with different signatures (discovery version takes `fixtureId`), so deduplication would add complexity for no gain
- The `err instanceof Error ? err.message : String(err)` pattern appears 7 times in this file alone (32 across the codebase) — a pre-existing convention, not something introduced by this feature
- No dead code, no unused imports

### Operational Concerns — Concern

**Standings cache never expires.** The `standingsCache` at `prediction-pipeline.ts:241` is an in-memory `Map` inside the `createPredictionPipeline` closure. Since the pipeline is created once at startup (`src/index.ts:132`) and reused by the scheduler, this cache persists for the lifetime of the process. Standings fetched at 8am would still be served at midnight.

The cache is small (bounded by number of configured leagues × seasons, currently ~5-10 entries), so memory is not a concern. But staleness could matter — standings change after every match day. The team/player stats cache uses a 24-hour TTL via the database; the standings cache has no TTL at all.

**Mitigating factors:** The scheduler typically runs every few hours, and the process is restarted at least daily in production (Docker restarts). Standings don't change during a single pipeline run. So this is low-risk in practice.

## What's Done Well

- **Clean two-phase separation** — the `gatherFixtureStats` / `processFixture` split is exactly the right abstraction level. No god-function, no excessive decomposition.
- **Graceful degradation hierarchy** — hard deps (standings) block, soft deps (H2H, injuries, enriched stats) fall back. This matches real-world importance correctly.
- **`Promise.allSettled` for parallel fetches** — both in the standings/H2H/injuries batch and the team/player stats batch. Individual failures don't cascade.
- **Standings cache** eliminates redundant API calls when multiple fixtures share a league — the most common case in production.
- **Test quality** — 33 pipeline tests covering happy path, error paths, edge cases, call ordering, and multi-fixture scenarios. The "odds refreshed after stats" test (`pipeline.test.ts:1166`) is a smart invariant assertion that would catch any accidental reordering.
- **`date.split("T")[0]`** fix in `client.ts:54` — subtle bug fix preventing the API from receiving a full ISO timestamp when it expects a date string.

## Must-Do Changes

- [ ] **Add TTL to standings cache** (`prediction-pipeline.ts:241-250`). The cache never expires, which means standings fetched hours ago will be reused across scheduler runs. Add a `fetchedAt` timestamp and check it against `STATS_CACHE_TTL` (or a separate standings TTL), matching the pattern used by `statsCache.getTeamStats()`. Alternatively, clear the cache at the start of each `run()` call — this is simpler and ensures each pipeline run gets fresh standings while still deduplicating within a run.

- [ ] **Clear `standingsCache` at the start of `run()`** (simplest fix). Add `standingsCache.clear()` as the first line of `run()` at `prediction-pipeline.ts:543`. This ensures per-run deduplication (the primary goal) without cross-run staleness.

## Should-Do Changes

- [ ] **Add a test asserting standings cache deduplication.** Two fixtures in the same league should result in only one `getStandings` call. The existing "multiple fixtures" test at `pipeline.test.ts:1211` should assert `fc.getStandings` was called once, not twice.

## Questions for the Author

None — the implementation is well-aligned with the plan, and the design decisions are sound.
