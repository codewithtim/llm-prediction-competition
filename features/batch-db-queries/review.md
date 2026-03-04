# Review: Batch DB Queries (N+1 Elimination)

**Reviewed:** 2026-03-04
**Reviewer:** Claude (Principal Engineer Review)
**Verdict:** APPROVED WITH CHANGES

## Summary

These changes eliminate N+1 query patterns across the API routes and the weight iteration service. The approach is solid: new batch methods (`getAllPerformanceStats`, `findByIds`) replace per-competitor/per-market loops, and a shared `computeStats` helper deduplicates the stats calculation logic. Test coverage for the new repo methods is thorough. One blocking issue found in `config.ts`.

## Findings

### Architecture & Design — Pass
- N+1 queries correctly replaced with bulk fetch + Map lookup pattern in `competitors.ts`, `dashboard.ts`, and `iteration.ts`
- `computeStats` extracted as a shared pure function — good deduplication
- `buildLeaderboard()` precomputed once in `iterateAll()` and passed to each `iterateCompetitor()` call — eliminates redundant DB hits
- `findByIds` with empty-array guard is the right pattern for batch lookups

### TypeScript & Type Safety — Pass
- `PerformanceStats` type properly defined at module scope in `bets.ts`
- `BetRow` inferred from schema with `$inferSelect` — correct
- Optional chaining used appropriately for stats lookup (`stats?.accuracy ?? 0`)

### Data Validation & Zod — Pass
- No new external boundaries introduced; existing validation unchanged

### Database & Drizzle ORM — Pass
- `findByIds` uses parameterised `inArray` — no injection risk
- `getAllPerformanceStats` fetches all rows in one query then groups in-memory — correct approach for a small dataset
- Empty array guard on `findByIds` prevents Drizzle from generating `WHERE id IN ()` (which is invalid SQL)

### Security — Pass
- No secrets exposed, no new external inputs, no changes to authentication or encryption

### Testing — Pass
- `getAllPerformanceStats`: 4 tests covering empty state, multi-competitor grouping, consistency with `getPerformanceStats`, and pending/failed counts
- `findByIds`: 4 tests covering matching, empty input, non-existent IDs, and all-exist cases
- Mock surfaces updated in `helpers.ts` and all test files to include new methods
- Consistency test (`matches single-competitor getPerformanceStats`) is a smart addition

### Error Handling & Resilience — Pass
- `emptyStats` fallback in API routes handles competitors with no bets gracefully
- `statsMap.get(c.id)` with `?? 0` fallback in `buildLeaderboard` is safe

### Code Quality & Conventions — Concern
- `emptyStats` object is duplicated identically in `competitors.ts:21-33` and `dashboard.ts:30-42`. Consider extracting to a shared constant if more routes need it. Not blocking but worth noting.

### Operational Concerns — Fail
- **`config.ts:56`**: `predictionLeadTimeMs: 3000 * 60 * 1000` — this is **3,000 minutes** (50 hours), not 30 minutes. The comment says "30 minutes before kickoff" but the value is 100x too large. This will cause the prediction pipeline to consider every fixture within 50 hours as eligible, which is almost certainly unintended.

## What's Done Well

- `computeStats` extracted cleanly — `getPerformanceStats` and `getAllPerformanceStats` share the exact same logic, eliminating drift risk
- `findByIds` includes the empty-array guard — a common mistake to miss
- Consistency test in `bets.test.ts` that verifies `getAllPerformanceStats` matches `getPerformanceStats` for the same competitor — this catches logic divergence automatically
- `precomputedLeaderboard` parameter in `iterateCompetitor` is a clean optimisation that avoids rebuilding the leaderboard N times during `iterateAll`
- Planning context updated in `.claude/skill-context/planning.md` with the N+1 rule — good institutional knowledge capture

## Must-Do Changes

- [ ] **Fix `predictionLeadTimeMs` in `src/orchestrator/config.ts:56`**: Value is `3000 * 60 * 1000` (50 hours) but should be `30 * 60 * 1000` (30 minutes). This will cause predictions to run far too early for fixtures, wasting API calls and LLM tokens.

## Should-Do Changes

- [ ] Extract `emptyStats` to a shared constant (e.g. in `bets.ts` alongside `PerformanceStats` type) to avoid duplication between `competitors.ts` and `dashboard.ts`
- [ ] Consider whether `getAllPerformanceStats` should include an optional status filter (e.g. only active competitors' bets) to avoid loading the entire bets table as the dataset grows. Not urgent for current scale.

## Questions for the Author

- Was the `predictionLeadTimeMs` change to `3000` intentional (e.g. temporarily widening the window for testing)? If so, it should be reverted before merging to main.
- The `features/iterate-weight-verification/research.md` deletion — is this intentional cleanup or accidental?
