# Review: Bet State Machine

**Reviewed:** 2026-03-03
**Reviewer:** Claude (Principal Engineer Review)
**Plan:** [plan.md](./plan.md)
**Verdict:** APPROVED WITH CHANGES

## Summary

The bet state machine introduces a proper write-ahead pattern, error classification, order confirmation polling, and retry logic — all legitimate improvements to a system that previously silently discarded failed bets. The core mechanics are correct and the production bug fixes (CLOB silent failures, ghost orders, unwired services) were identified and resolved well. The main gaps are an operational hole for bets stuck permanently in `submitting` status, a planned config option (`retryDelayMs`) that was specified but never implemented, and several exported symbols that are dead code.

---

## Findings

### Architecture & Design — Pass

The implementation closely follows the plan. All 12 steps plus post-implementation bug fixes are addressed. Layer boundaries are respected throughout: new domain services (`bet-errors.ts`, `bet-retry.ts`, `order-confirmation.ts`) accept infrastructure types via dependency injection and don't import from infrastructure directly. The write-ahead pattern in `betting.ts:116` is correct — the row is created with `submitting` before the API call, giving duplicate detection a record to hit even on concurrent runs. The scheduler integration pattern (boolean flags, immediate-then-interval, structured result logging) is consistent with existing tasks.

One design concern: `bet-retry.ts` uses `updateStatus(bet.id, "submitting")` (line 44) as a write-ahead step before retrying, which is correct — but if the process crashes between setting `submitting` and completing the API call, the bet is stuck in `submitting` permanently. The order confirmation service only queries `pending` bets (`order-confirmation.ts:30`), so orphaned `submitting` bets will never be recovered. See operational concerns for detail.

### TypeScript & Type Safety — Concern

**`BetStatus` type reduplicated in repository layer.** `src/infrastructure/database/repositories/bets.ts:3-12` defines a local `BetStatus` union identical to `src/domain/models/prediction.ts`. This is a layer violation and a maintenance risk — adding a future status requires changes in two places. The repository should import the type from the domain model.

**`TERMINAL_CATEGORIES` filter uses an unsafe cast.** `bets.ts:68`:
```typescript
!TERMINAL_CATEGORIES.includes(b.errorCategory as BetErrorCategory)
```
`b.errorCategory` is a raw string from SQLite. The cast bypasses the type system. Since we only ever write valid values, this is practically safe, but an explicit guard (`Object.values(TERMINAL_CATEGORIES).includes(b.errorCategory)`) would be more correct.

**`isRetryable` is exported and tested but never imported.** `bet-errors.ts:23-31` exports this function; no production file imports it. The retry service uses `findRetryableBets` for filtering instead. Dead exported symbol — see code quality.

### Data Validation & Zod — Pass

The two-layer CLOB response validation in `betting-client.ts:51-61` is correct. The error-field check (`"error" in response`) handles the CLOB client's `throwOnError: false` default, and the subsequent `orderId` existence check prevents the `"[object Object]"` regression from recurring. Not using Zod here is acceptable given the CLOB SDK's non-standard response shape.

### Database & Drizzle ORM — Concern

**`orderId` written as empty string, not null.** `betting.ts:118` creates the submitting row with `orderId: ""`. The schema column is `.notNull()`, so empty string is the workaround. The ghost order check (`!bet.orderId`) correctly treats empty string as falsy, so there's no functional bug. However, making the column nullable and using `null` for submitting rows would be semantically cleaner and remove the need for string sentinel detection.

**`attempts` default contradicts plan.** Schema defaults to `0`, plan specified `1`. The current code sets `attempts: 1` on first failure and leaves it at `0` on success, meaning "0 attempts" on a successful bet. This is a minor semantic oddity — `attempts` only counts failed attempts, not total attempts.

**`findRetryableBets` applies partial DB filter then JS post-filter** (`bets.ts:53-60`). The `lt(bets.attempts, maxAttempts)` filter runs in SQL but the terminal category exclusion runs in JS. This could be pushed entirely to the DB with `notInArray(bets.errorCategory, TERMINAL_CATEGORIES)`, which would be more efficient at scale. Not blocking at current data volumes.

**Migration is correct and safe.** `0007_boring_wraith.sql` adds four nullable/defaulted columns with no drops or renames. The status enum is purely TypeScript-level in Drizzle/SQLite so no migration is needed for the new status values.

### Security — Pass

Wallet credentials flow correctly: decrypted only when needed, passed as structured values (never logged). Error messages stored in `errorMessage` column are raw Polymarket API strings — these could include balance amounts, which is acceptable for an internal-only operator dashboard. No credentials appear in log output.

### Testing — Concern

**`getPerformanceStats` mock is stale in two test files.** Both `bet-retry.test.ts:67-80` and `order-confirmation.test.ts:67-80` mock `getPerformanceStats` returning an object without the new `failed` and `lockedAmount` fields added in this feature. The `as unknown as BetsRepo` cast hides the mismatch. If any code path in these tests were to call `getPerformanceStats`, the missing fields would silently be `undefined`. The mock should be updated to include all current fields.

**Order confirmation error-resilience test doesn't actually test cross-competitor isolation.** `order-confirmation.test.ts:248-273` — both `bet-1` and `bet-2` have `competitorId: "comp-a"`, so there is only one call to `getOpenOrders`. When that call fails, the entire competitor group is skipped via `continue`, meaning `bet-2` is also skipped. The test passes with `errors: 1` but never demonstrates that failures for one competitor don't affect another. The test should use two different competitor IDs to actually validate the resilience property it's named for.

**Scheduler tests don't cover new `runOrderConfirmation` / `runBetRetry` functions.** The diff to `scheduler.test.ts` only adds config values — no new test cases for overlap prevention (the `orderConfirmationRunning` / `betRetryRunning` flags), for optional service injection, or for stop/cleanup of the new timers.

**New tests are otherwise good.** Repository tests use in-memory SQLite with migrations (`bets.test.ts`), which is correct. The write-ahead ordering test in `betting.test.ts:135-159` (tracking `callOrder: string[]`) is an elegant pattern. The `bet-errors.test.ts` coverage of all category patterns and non-Error inputs is thorough.

### Error Handling & Resilience — Concern

**Ghost order counter is misleading.** `order-confirmation.ts:81` increments `result.cancelled++` when a ghost order is detected and marked as `failed` in the DB. The returned `OrderConfirmationResult` tells callers (and the scheduler log at `scheduler.ts:143`) that N orders were "cancelled" when they are actually in `failed` state. This makes the scheduler log output and any future metrics based on the result incorrect. The counter should increment `result.cancelled` only when `updateStatus(id, "cancelled")` is called; ghost orders that become `failed` should have their own counter or at minimum not be counted as cancelled.

**`retryDelayMs` was planned but not implemented.** `config.ts` has `retry.maxRetryAttempts` but not the `retryDelayMs` specified in the plan. `findRetryableBets` has no filter on `lastAttemptAt`, so a bet that fails every 10 minutes (the scheduler interval) is retried every 10 minutes with no minimum cooldown. For `network_error` this is probably fine; for `rate_limited` it could make the rate limiting worse.

**Stuck `submitting` bets are unrecoverable.** A bet in `submitting` with an empty `orderId` will stay there permanently if the process crashes mid-flight. The order confirmation service queries only `pending` bets. There is no timeout or cleanup for `submitting` bets. Over time, crashed or interrupted attempts accumulate as permanent `submitting` rows, affecting the duplicate check (which blocks new bets on the same market if a `submitting` bet exists).

### Code Quality & Conventions — Concern

**Three exported symbols are dead code.**

1. `isRetryable` in `bet-errors.ts:23-31` — exported, tested, not called by any production code.
2. `findByStatusMultiple` in `bets.ts:43-45` — added to the repository, tested, not called anywhere.
3. `findByMarketAndCompetitor` in `bets.ts:47-53` — same situation; `bettingService` still uses `findByCompetitor` + JS filter.

These add test coverage noise and create the expectation that callers depend on them. Either integrate or remove.

**Naming: `BLOCKING_STATUSES` is clear and well-placed** (`betting.ts:43`). The discriminated union on `updateBetAfterSubmission` is well-typed and prevents mixing up success/failure update shapes.

### Operational Concerns — Concern

**`submitting` status missing from UI badge.** `status-badge.tsx` now has `failed` in `STATUS_COLORS` but not `submitting`. If a bet appears in the dashboard with `submitting` status, it would fall through to the default/unknown color path.

**`pendingBets` dashboard count excludes `submitting` bets.** `dashboard.ts:89` filters on `status === "pending"` only. Operators could see "0 pending bets" while the system is mid-placement on several bets. For a dashboard metric labelled "Pending Bets", including `submitting` would be more accurate.

**Retry runs immediately on startup.** `scheduler.ts:237` calls `runBetRetry()` immediately when the scheduler starts. On rapid restarts (crash loops), this retries all retryable bets on every startup with no delay. Combined with the missing `retryDelayMs`, a restart loop could hammer Polymarket with retries.

---

## What's Done Well

- **Write-ahead pattern is correctly implemented.** `betting.ts:116-159` creates the row before the API call, transitions it on success or failure. The ordering test (`callOrder: ["create", "placeOrder"]`) verifies this is not just structural but sequentially enforced.
- **CLOB silent failure fix is robust.** `betting-client.ts:51-61` correctly handles the `throwOnError: false` default with a two-layer check: error-field presence, then orderID presence. This is the right fix for a subtle third-party SDK behavior.
- **Ghost order recovery is practical.** The `[object Object]`/`"undefined"`/`""` detection in `order-confirmation.ts:68-72` handles real production garbage values that accumulated before the fix. The tests explicitly cover these cases.
- **Error classification is extensible.** `bet-errors.ts` uses a pattern array that's easy to extend as real Polymarket error shapes are observed in production.
- **P&L fix is semantically correct.** `bets.ts:getPerformanceStats` now only sums settled bets for `totalStaked`/`totalReturned`. Failed bets that never spent money no longer appear as losses.
- **Repository tests use real in-memory SQLite.** `bets.test.ts` runs full migrations on `:memory:` before testing — the correct approach for Drizzle repositories. The new test cases for `findRetryableBets`, `updateBetAfterSubmission`, and `findByStatusMultiple` are well-structured.
- **`index.ts` wiring is clean.** Building the `walletConfigs` map from the loaded engines and passing to both services is the right pattern. The optional fields on `SchedulerDeps` (`orderConfirmationService?`, `betRetryService?`) are reasonable for testability.

---

## Must-Do Changes

- [x] **Fix ghost order counter mismatch** — `OrderConfirmationResult` now has a dedicated `failed` field; ghost orders correctly increment `result.failed` instead of `result.cancelled`. Scheduler logs include the new count.

- [x] **Add cleanup for stuck `submitting` bets** — `order-confirmation.ts` now queries `findByStatus("submitting")` first and marks any submitting bet older than `maxOrderAgeMs` as `failed` with `errorCategory: "unknown"`. Prevents orphaned rows from permanently blocking the duplicate check on the same market.

- [ ] **Remove or integrate `isRetryable`, `findByStatusMultiple`, `findByMarketAndCompetitor`** — These are exported, tested, and unused in production. To be addressed in follow-up commit.

---

## Should-Do Changes

- [ ] **Import `BetStatus` from domain instead of redefining it** — `src/infrastructure/database/repositories/bets.ts:3-12`. Replace the local type with `import type { BetStatus } from "../../../domain/models/prediction"` to prevent the two types diverging.

- [ ] **Implement `retryDelayMs`** — Add `retryDelayMs` to `RetryConfig` and `DEFAULT_CONFIG`. In `findRetryableBets`, add a `lt(bets.lastAttemptAt, new Date(Date.now() - retryDelayMs))` filter (or pass the threshold to the repo). Prevents hammering Polymarket with immediate retries after rate limiting.

- [x] **Add `submitting` to `status-badge.tsx` color map** — Added with amber color.

- [x] **Include `submitting` in dashboard pending count** — Dashboard now filters `submitting || pending || filled` for the pending bets widget.

- [ ] **Update stale mock for `getPerformanceStats`** — `tests/unit/domain/services/bet-retry.test.ts:67-80` and `order-confirmation.test.ts:67-80`. Add `failed: 0, lockedAmount: 0` to match the current return type. This future-proofs the mocks and makes the `as unknown as BetsRepo` cast less dangerous.

- [ ] **Add scheduler tests for new run functions** — `tests/unit/orchestrator/scheduler.test.ts`. Add tests for: (a) `orderConfirmationRunning` flag preventing concurrent runs, (b) optional service injection (scheduler starts without them), (c) timers cleared on `stop()`.

- [x] **Make `orderId` nullable in schema** — Done via migration `0008`. Submitting bets now use `null`; ghost order check uses `== null`.

---

## Questions for the Author

1. **`attempts` default: 0 or 1?** The plan specified `default(1)`, the schema uses `0`. Successful bets have `attempts = 0`, failed bets have `attempts = 1`. If `attempts` tracks failed attempts only, `failedAttempts` would be a clearer name.

2. **`findByStatusMultiple` and `findByMarketAndCompetitor`** — Were these added in anticipation of a future refactor (e.g. using `findByMarketAndCompetitor` instead of `findByCompetitor + JS filter` in `bettingService`)? If so worth a TODO comment before removing.
