# Review: Double Bet Prevention

**Reviewed:** 2026-03-03
**Reviewer:** Claude (Principal Engineer Review)
**Plan:** [features/double-bet-prevention/plan.md](plan.md)
**Verdict:** APPROVED

## Summary

This feature closes the race condition gap in bet placement by adding three layers of duplicate prevention: an atomic `INSERT...SELECT...WHERE NOT EXISTS` in the betting service, a pre-retry active-bet guard in the retry service, and a partial unique index as a DB-level safety net. The implementation deviates from the plan's transaction approach in favour of a single SQL statement (which is strictly better for atomicity), extracts a shared `ACTIVE_BET_STATUSES` constant to eliminate 7+ repetitions, and provides thorough test coverage (22 new repository tests, 3 new service tests, 2 new retry tests). All 551 tests pass with clean TypeScript compilation.

## Findings

### Architecture & Design — Pass

The implementation follows the plan's three-layer strategy precisely:
1. Atomic check-and-create via `createIfNoActiveBet` at `bets.ts:21-34`
2. Pre-retry guard via `hasActiveBetForMarket` at `bet-retry.ts:42-53`
3. Partial unique index at `drizzle/0012_double-bet-prevention.sql`

Domain boundaries respected. `ACTIVE_BET_STATUSES` is exported from the domain model (`prediction.ts:52-53`) and imported by both infrastructure (`bets.ts:2`) and domain services (`betting.ts:5`). No layer violations — infrastructure imports from domain, not the reverse.

The deviation from plan (raw SQL `INSERT...SELECT` vs `db.transaction()`) is an improvement. A single SQL statement provides atomicity without explicit transaction wrapping, eliminating the possibility of interleaving between read and write within a transaction. SQLite executes single statements atomically by default.

The fast-path duplicate check in `betting.ts:72-80` is well-documented as an optimisation, with the comment at line 72-73 clearly stating that `createIfNoActiveBet()` is the real safety net. Good layered defence.

### TypeScript & Type Safety — Pass

- `ACTIVE_BET_STATUSES` at `prediction.ts:53` uses `as const satisfies BetStatus[]` — the gold standard for typed constant arrays. The `satisfies` constraint ensures the values are valid `BetStatus` members at compile time, while `as const` preserves the literal types.
- `createIfNoActiveBet` return type `Promise<"created" | "duplicate">` at `bets.ts:21` is a clean string discriminated union. Callers check the value explicitly (`betting.ts:126`).
- `BLOCKING_STATUSES` at `betting.ts:47` correctly widens to `Set<string>` so `.has()` accepts `BetStatus` arguments without type errors.
- `hasActiveBetForMarket` has an explicit `Promise<boolean>` return type at `bets.ts:36`.
- No `any` types in production code. No non-null assertions.

### Data Validation & Zod — Pass

No new external data boundaries introduced. Both `createIfNoActiveBet` and `hasActiveBetForMarket` operate on internal data (bet records from the repository, string IDs from the prediction pipeline). The `bet` parameter to `createIfNoActiveBet` is typed as `typeof bets.$inferInsert`, which is Drizzle-generated from the schema — correct.

### Database & Drizzle ORM — Pass

**Raw SQL atomicity** (`bets.ts:24-32`): The `INSERT INTO bets (...) SELECT ... WHERE NOT EXISTS (...)` is a single SQL statement. SQLite executes it atomically without explicit transaction wrapping. This is safer than the plan's two-statement transaction approach.

**Parameterisation**: All variable values in the raw SQL use Drizzle's `sql` tagged template (`${bet.id}`, `${bet.marketId}`, etc.), which parameterises them. The only `sql.raw()` usage is for `statusList` at line 30, which is built from the compile-time `ACTIVE_BET_STATUSES` constant — no injection risk.

**Timestamp handling**: `Math.floor(placedAt.getTime() / 1000)` at `bets.ts:26` correctly converts to Unix seconds, matching the schema's `integer("placed_at", { mode: "timestamp" })` which stores seconds since epoch. This duplicates Drizzle's internal conversion but is necessary because raw SQL bypasses the ORM.

**Column list** (`bets.ts:25`): 13 of 17 columns are listed. The 4 omitted columns (`settled_at`, `profit`, `error_message`, `error_category`) are all nullable with no NOT NULL constraint, so SQLite defaults them to NULL. The `last_attempt_at` column is also omitted and nullable. The comment at lines 19-20 documents the schema sync requirement — good.

**Migration** (`0012_double-bet-prevention.sql`): Additive-only — creates a partial unique index. No destructive schema changes. SQLite supports partial indexes (requires version 3.8.0+, which Bun's bundled SQLite and Turso both exceed). The status list in the index (`'submitting', 'pending', 'filled'`) matches `ACTIVE_BET_STATUSES`.

**`hasActiveBetForMarket`** (`bets.ts:36-50`): Uses Drizzle query builder with full parameterisation. The `[...ACTIVE_BET_STATUSES]` spread at line 44 is necessary because `inArray` expects a mutable array, not a readonly tuple. Clean.

### Security — Pass

No secrets involved. All bet IDs, market IDs, and competitor IDs are internal data. The raw SQL uses parameterised values for all dynamic content. `sql.raw()` only processes the constant status list.

### Testing — Pass

Outstanding coverage. Every test from the plan's test matrix is implemented:

**Repository tests** (`bets.test.ts:360-603`):
- `createIfNoActiveBet`: 10 tests covering create success, duplicate for each active status (submitting/pending/filled), allow for each terminal status (failed/settled_won/settled_lost/cancelled), different-market, and different-competitor
- `hasActiveBetForMarket`: 9 tests covering all active statuses (true), all terminal statuses (false), no bets (false), different market (false), different competitor (false)
- Unique index constraint: 3 tests verifying DB-level rejection, failed-allows-new, settled-allows-new

All repository tests use in-memory SQLite with full migrations (`bets.test.ts:12-14`) — the gold standard for this project.

**Betting service tests** (`betting.test.ts:566-623`): 3 new tests in the "atomic duplicate prevention" describe block — covers duplicate return, created return, and verifies `createIfNoActiveBet` is called instead of `create`.

**Retry service tests** (`bet-retry.test.ts:266-312`): 2 new tests — skips when active bet exists, proceeds when no active bet exists. Both verify the full chain (updateStatus, placeOrder).

Mock repos updated in both test files to include `createIfNoActiveBet` and `hasActiveBetForMarket` methods (`betting.test.ts:123-124`, `bet-retry.test.ts:57-58`).

### Error Handling & Resilience — Pass

- `createIfNoActiveBet` returns a discriminated union rather than throwing on duplicate — callers handle it with a simple equality check (`betting.ts:126`). No exceptions for expected business logic.
- If the partial unique index constraint fires (shouldn't in normal operation), the raw SQL will throw a UNIQUE constraint error. This propagates up to the `placeBet` catch block at `betting.ts:147`, which already handles errors gracefully by updating the bet to "failed" status.
- The retry service's active-bet check at `bet-retry.ts:42-53` logs a structured info message with betId, marketId, and competitorId — actionable for debugging.
- TOCTOU gap in retry service is documented at `bet-retry.ts:42-44` with the note that the partial unique index is the real safety net. Correct analysis.

### Code Quality & Conventions — Pass

- `ACTIVE_BET_STATUSES` constant at `prediction.ts:52-53` eliminates 7+ repetitions across the codebase. JSDoc comment explains the semantic meaning ("capital in flight").
- Naming is clear and consistent: `createIfNoActiveBet`, `hasActiveBetForMarket`, `ACTIVE_BET_STATUSES`, `BLOCKING_STATUSES`.
- Comments document the dual-check pattern (`betting.ts:72-73`), TOCTOU mitigation (`bet-retry.ts:42-44`), and raw SQL rationale (`bets.ts:19-20`).
- No dead code, no unused imports.
- The `create()` method is retained (used by test setup and other callers) — correct, no vestigial code.

### Operational Concerns — Pass

- Migration `0012_double-bet-prevention.sql` is additive — `CREATE UNIQUE INDEX` can be applied to a running system without downtime.
- The plan documents a pre-migration check query for existing duplicate active bets. In practice, the application-level check has been preventing duplicates, so the index creation should succeed.
- No scheduler changes needed — the duplicate prevention is entirely within the betting and retry service layers.
- No performance concerns — the `INSERT...SELECT...WHERE NOT EXISTS` is a single indexed query (the partial unique index on `market_id, competitor_id` covers the WHERE NOT EXISTS subquery).

## What's Done Well

- **Single-statement atomicity** — choosing `INSERT...SELECT...WHERE NOT EXISTS` over a transaction with separate SELECT + INSERT is the right call for SQLite. It's simpler, faster, and eliminates the transaction abort/retry concern.
- **`ACTIVE_BET_STATUSES` constant** (`prediction.ts:52-53`) — extracted during /simplify with `as const satisfies BetStatus[]`, which provides both compile-time validation and runtime value access. Used across 5 files, eliminating all hardcoded status lists.
- **Three-layer defence** — fast-path check (`betting.ts:72-80`), atomic insert (`bets.ts:21-34`), and DB constraint (`0012_double-bet-prevention.sql`) each independently prevent duplicates. Any one layer can fail without causing double bets.
- **Documentation at decision points** — the dual-check comment (`betting.ts:72-73`), TOCTOU note (`bet-retry.ts:42-44`), and column sync warning (`bets.ts:19-20`) all explain *why*, not just *what*.
- **Repository test coverage** — 22 new tests with in-memory SQLite and full migrations, covering every active status, every terminal status, cross-market, and cross-competitor scenarios. The unique index constraint tests (`bets.test.ts:576-603`) verify the DB-level safety net directly.
- **Test fixture cleanup** — adding `market-2` to the beforeEach setup (`bets.test.ts:27-34`) enables proper foreign key compliance for different-market tests without workarounds.

## Must-Do Changes

None. The implementation is correct, well-tested, and well-documented.

## Should-Do Changes

- [ ] **Add comment for `activeBets` vs `pending` semantic difference** — In `bets.ts:137-140`, `pending` count includes submitting bets (via `ACTIVE_BET_STATUSES`), but `lockedAmount` at line 140-141 only counts `pending || filled` (excludes submitting). This is defensible (submitting bets haven't hit the exchange), but a one-line comment explaining the intentional difference would prevent future confusion.

## Questions for the Author

None — the implementation matches the plan's intent, the deviation to `INSERT...SELECT` is an improvement, and the design decisions are well-documented.
