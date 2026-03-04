# Review: Add Status Guard to Iteration & Expand Feedback Prompt Stats

**Reviewed:** 2026-03-04
**Reviewer:** Claude (Principal Engineer Review)
**Plan:** [plan.md](./plan.md)
**Commits:** `8ffa1a5` (feature), `cac89e8` (simplify pass)
**Verdict:** APPROVED

## Summary

This feature adds a status guard to `iterateCompetitor()` so only `active` and `pending` competitors can be iterated, updates `iterateAll()` to include pending competitors, and expands the LLM feedback prompt with three additional performance stats (`totalStaked`, `totalReturned`, `lockedAmount`). The implementation is clean, follows the plan precisely, and has good test coverage. A follow-up simplify pass improved the constant placement and reduced test duplication.

## Findings

### Architecture & Design — Pass

- Implementation matches the plan exactly across all four changed files.
- `ITERABLE_STATUSES` is correctly placed at module level with `CompetitorStatus` typing, following the same pattern as `ACTIVE_BET_STATUSES` in `src/domain/models/prediction.ts`.
- `iterateAll()` derives its status queries from `ITERABLE_STATUSES` via `.map()`, so both the guard and the bulk fetch share a single source of truth.
- Domain boundary respected: `iteration.ts` imports `CompetitorStatus` from the domain types layer — this is a valid dependency direction (competitor module → domain types).
- Good design choice: `buildLeaderboard()` still only fetches `"active"` competitors (`iteration.ts:47`), not pending. Pending competitors shouldn't appear on the leaderboard before activation. This is consistent with the trade-off documented in the plan.

### TypeScript & Type Safety — Pass

- `ITERABLE_STATUSES: CompetitorStatus[]` is properly typed, ensuring only valid statuses can be added to the array.
- The `as CompetitorStatus` cast on `iteration.ts:121` is necessary because `competitor.status` comes from the DB as `string` (Drizzle `text()` column). The cast is safe — if an unexpected string value exists, `.includes()` will correctly return `false` and the guard will reject it. The cast doesn't bypass any real type check.
- Discriminated union `WeightIterationResult` (pre-existing) is used correctly for the new error path.

**Note (pre-existing, not introduced here):** Three `PerformanceStats`-like types exist with overlapping shapes — `feedback.ts:20`, `domain/models/competitor.ts:10`, and `shared/api-types.ts:1`. The `feedback.ts` type is now a 9-field subset while `PerformanceStatsDTO` has 11 fields. These could be unified with `Pick<>`/`Omit<>` to prevent future drift, but this is a pre-existing concern and not in scope for this change.

### Data Validation & Zod — Pass

No new external data boundaries introduced. The three new fields (`lockedAmount`, `totalStaked`, `totalReturned`) are computed from DB rows inside `getPerformanceStats()` (`bets.ts:131-161`) — all internal data, no validation needed.

### Database & Drizzle ORM — Pass

- No raw SQL, all queries use Drizzle's query builder.
- Two `findByStatus` calls in `iterateAll()` instead of a single `inArray` query is a minor inefficiency but acceptable — the competitors table is small and both calls run concurrently via `Promise.all`.
- No write-path changes.

### Security — Pass

- Error messages include competitor ID and status value, but no secrets or sensitive data.
- No new environment variables or API credentials involved.

### Testing — Pass

- All six test scenarios from the plan are covered:
  - `disabled` rejected (`iteration.test.ts:360`)
  - `error` rejected (`iteration.test.ts:374`)
  - `pending` allowed (`iteration.test.ts:388`)
  - `active` allowed (pre-existing tests)
  - `iterateAll` includes pending (`iteration.test.ts:427`)
  - Prompt includes new stats (`feedback.test.ts:171`)
- The `depsWithFindById` helper (`iteration.test.ts:337-346`) cleanly reduces mock duplication across the four error-handling tests.
- `EMPTY_STATS` updated with `failed` and `lockedAmount` fields (`iteration.test.ts:60-61`) to match the actual `getPerformanceStats` return shape.
- `makeInput()` in `feedback.test.ts:29-31` includes realistic values for the three new fields.

### Error Handling & Resilience — Pass

- Status guard returns a structured error result (not a throw), consistent with the existing pattern for unknown competitor.
- Error message is clear and actionable: `Competitor wt-test has status "disabled" — only active and pending competitors can be iterated`.
- If one competitor fails in `iterateAll`, the loop continues to the next — this resilience is pre-existing and preserved.

### Code Quality & Conventions — Pass

- Clean, focused change. No dead code, no unused imports.
- `[...ITERABLE_STATUSES].map(...)` spread in `iterateAll` is readable and appropriate for a 2-element array.
- Field-by-field mapping in the `performance` object (`iteration.ts:146-155`) is explicit rather than using a spread — consistent with the existing style in this file.
- New prompt lines (`feedback.ts:195-197`) follow the same formatting pattern as existing lines.

### Operational Concerns — Pass

- No scheduler, pipeline, or migration changes.
- No new logging added for the status guard rejection, but the caller (`scripts/iterate.ts`) logs results. The structured error result provides sufficient context.
- No backwards compatibility concerns — `iterateCompetitor` now rejects more inputs (non-active/pending), which is strictly more restrictive. No external callers would break since this is an internal script.

## What's Done Well

- **Single source of truth:** `ITERABLE_STATUSES` drives both the guard and `iterateAll`, so they can't go out of sync.
- **Typed constant:** Using `CompetitorStatus[]` instead of raw `Set<string>` means adding a typo like `"actve"` would be caught at compile time.
- **Good trade-off documentation:** The plan clearly explains why `pending` is included (cold-start path) and why `pending`/`failed` bet counts are omitted from the prompt.
- **Test helper:** `depsWithFindById` is a clean pattern that could be extended to other override scenarios.
- **Prompt ordering:** Staking stats placed after P&L but before outcomes gives the LLM a natural flow: summary metrics → capital context → detailed history.

## Must-Do Changes

None.

## Should-Do Changes

- [ ] **`performanceSnapshot` doesn't include new stats** — `iteration.ts:183-192` saves a `PerformanceSnapshot` with only 6 fields (`totalBets`, `wins`, `losses`, `accuracy`, `roi`, `profitLoss`) when creating a version record. The LLM now sees `totalStaked`, `totalReturned`, and `lockedAmount`, but these aren't captured in the snapshot. If the snapshot is ever used to show "what the LLM saw when it made this version," it would be incomplete. Consider expanding `PerformanceSnapshot` in `schema.ts:71-78` to include these fields. This is a schema change (JSON column, additive), so it's safe.

## Questions for the Author

None — the implementation is straightforward and the plan's trade-off rationale is clear.
