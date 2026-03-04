# Review: Auto-Bump Bet to Minimum Size on `order_too_small`

**Reviewed:** 2026-03-05
**Reviewer:** Claude (Principal Engineer Review)
**Plan:** `features/min-bet-auto-bump/plan.md`
**Verdict:** APPROVED

## Summary

The feature auto-bumps bet amounts to Polymarket's minimum size when an `order_too_small` error is encountered during retry. The implementation follows the plan precisely — moving `order_too_small` from terminal to retryable, extracting the min size from the error message via regex, bumping the bet amount with a `maxStakePerBet` safety guard, and annotating both the prediction and audit log. Code quality is high, test coverage is thorough (including flow tests covering the full place→fail→retry→success lifecycle), and the approach is appropriately minimal.

## Findings

### Architecture & Design — Pass

The implementation matches the plan exactly. The decision to handle auto-bump in the retry service rather than inline in `placeBet` is sound — it leverages existing retry infrastructure and keeps the initial bet flow simple.

- `extractMinBetSize` is correctly placed in `bet-errors.ts` alongside `classifyBetError` — both are error-message parsing utilities (`src/domain/services/bet-errors.ts:18-22`)
- `updateAmount` on the bets repo follows the existing repository pattern with DI via `db` (`src/database/repositories/bets.ts:158-167`)
- `addStakeAdjustment` on predictions repo follows the same pattern (`src/database/repositories/predictions.ts:37-53`)
- Dependencies (`predictionsRepo`, `maxStakePerBet`) are threaded through properly via the factory function deps object — no globals, no layer violations (`src/domain/services/bet-retry.ts:16-25`)
- Wiring in `src/index.ts:125-134` correctly passes `preds` and `DEFAULT_CONFIG.betting.maxStakePerBet`

### TypeScript & Type Safety — Pass

- `extractMinBetSize` accepts `unknown` and narrows properly with `instanceof Error` check (`bet-errors.ts:19`)
- The `match?.[1]` optional chaining handles the `RegExpMatchArray` correctly — avoids the strict mode `string | undefined` issue (`bet-errors.ts:21`)
- The `stakeAdjustment` local variable in `bet-retry.ts:71-78` uses a properly typed inline union (`| undefined`) rather than `any`
- The `StakeAdjustment` type in `api-types.ts:221-227` matches the schema column type in `schema.ts:145-151` — fields are identical
- Schema JSON column uses `.$type<>()` to get proper inference (`schema.ts:145-151`)
- Mock type casts (`as unknown as BetsRepo`) in tests are acceptable — they match the real API surface closely enough that mismatches would cause runtime test failures

### Data Validation & Zod — Pass

No new external data boundaries introduced. The `extractMinBetSize` regex operates on error messages from the Polymarket API which are already captured as strings in the DB. The function gracefully returns `null` when the pattern doesn't match, and the caller handles `null` correctly (falls back to original amount).

### Database & Drizzle ORM — Pass

- Migration `0017_cute_living_lightning.sql` is a safe additive `ALTER TABLE` — adds a nullable `text` column, no data migration needed
- `updateAmount` does a read-then-write (`bets.ts:158-167`). This is two queries instead of one, but it's acceptable: the shares recalculation needs the current `price`, and this runs inside the retry loop which processes one bet at a time. No concurrent writes to the same bet row are expected.
- `addStakeAdjustment` uses parameterised query via Drizzle's `.set()` — no SQL injection risk (`predictions.ts:48-52`)
- The `stakeAdjustment` column is nullable with no default, so existing rows get `NULL` — correct for SQLite

### Security — Pass

No secrets, API keys, or wallet credentials are logged or exposed in the new code. The `extractMinBetSize` function only operates on error message strings. Audit log metadata includes stake amounts (not sensitive). The `maxStakePerBet` guard prevents the system from placing unexpectedly large bets.

### Testing — Pass

Comprehensive test coverage across four layers:

1. **Unit tests for `extractMinBetSize`** — 4 tests covering real Polymarket error format, decimal values, unrelated messages, and null/undefined input (`bet-errors.test.ts:72-93`)
2. **Unit tests for auto-bump in retry service** — 7 tests covering: bumped amount in `placeOrder`, DB amount update, prediction annotation, audit metadata, fallback to original amount, min <= original (no bump), and max-stake guard (`bet-retry.test.ts:453-673`)
3. **Flow tests** — 4 scenarios testing the full lifecycle with stateful mocks sharing `storedBets` array (`min-bet-bump-flow.test.ts:126-637`):
   - Happy path: place → `order_too_small` → retry bumps → success
   - Guard: min exceeds max stake → stays failed
   - Guard: unparseable error → retries with original amount
   - Escalating min size → bumps again on next retry
4. **Repo integration tests** — `updateAmount` recalculates shares correctly, no-op for missing bet, `findRetryableBets` includes `order_too_small`, `addStakeAdjustment` writes JSON correctly (`bets.test.ts:677-709`, `predictions.test.ts:108-139`)

The flow tests use a clever stateful mock pattern with `storedBets` array and `.map((b) => ({ ...b }))` in `findRetryableBets` to avoid object reference sharing — this correctly simulates DB behaviour where each query returns fresh objects.

### Error Handling & Resilience — Pass

- Guard against bumping beyond `maxStakePerBet` is clean — logs a warning, pushes to `result.errors`, and `continue`s to the next bet (`bet-retry.ts:83-93`)
- When min size can't be extracted, the retry proceeds with the original amount — no error, no skip. This is the right fallback since the retry might succeed with the original amount or fail again with a new, parseable error message
- When min size is extracted but is less than or equal to the current amount, no bump occurs — handles the edge case where the error message is stale or misleading
- The `continue` on line 92 skips the bet entirely (doesn't increment `retried`), which is correct — the bet stays `failed` and can be retried later if config changes

### Code Quality & Conventions — Pass

- Clean separation of concerns: error parsing in `bet-errors.ts`, amount update in bets repo, annotation in predictions repo, orchestration in retry service
- The `stakeAdjustment` variable is built before the audit log call and spread conditionally — avoids duplicate code
- `retryAmount` is introduced at the top of the loop and used consistently throughout — the `placeOrder` call uses `retryAmount` rather than `bet.amount` (`bet-retry.ts:136`)
- No dead code, no commented-out code, no unused imports
- The `StakeAdjustment` type in `api-types.ts` is currently only used for documentation/export purposes — it's not referenced by the schema or repo. This is fine as it provides a clean API type for future consumers (e.g., UI display)

### Operational Concerns — Pass

- Structured logging with relevant context: `betId`, `minSize`, `maxStakePerBet` in the warning log (`bet-retry.ts:84-88`)
- The retry delay (default 1 minute via `retryDelayMs`) means there's a brief window between failure and retry. As noted in the plan, this is acceptable for sports betting where market prices don't change rapidly
- `maxStakePerBet` defaults to 10 in `DEFAULT_CONFIG` (`config.ts:62`), which is a reasonable safety net
- Migration is backwards compatible — existing rows have `NULL` for `stake_adjustment`

## What's Done Well

- **Minimal, focused changes** — the auto-bump logic is ~30 lines in the retry service, with supporting infrastructure cleanly split across the right files
- **Defensive guards** — `maxStakePerBet` prevents runaway stakes; null extraction falls back gracefully; min <= original is a no-op
- **Thorough flow tests** — the `min-bet-bump-flow.test.ts` tests exercise the real `createBettingService` and `createBetRetryService` together, catching integration issues that unit tests would miss
- **Object reference copy in mocks** (`findRetryableBets` returns `({ ...b })`) — correctly simulates DB behaviour and prevents subtle mutation bugs
- **Prediction annotation** provides an audit trail for stake changes that can be surfaced in the UI later
- **Plan followed precisely** — every task item maps to a specific code change, and all 22 tasks are completed

## Must-Do Changes

None.

## Should-Do Changes

- [ ] Consider adding an index on `predictions(market_id, competitor_id)` if `addStakeAdjustment` is called frequently — the current `WHERE market_id = ? AND competitor_id = ?` does a table scan. Low priority since predictions table is small and this runs at most once per retry.
- [ ] The `updateAmount` method in `bets.ts:158-167` does a SELECT then UPDATE (two round-trips). Could be a single `UPDATE bets SET amount = ?, shares = ? / price WHERE id = ?` using a raw SQL expression, but the current approach is clearer and correctness is more important than micro-optimization at this scale.

## Questions for the Author

None — the implementation is clean and matches the plan.
