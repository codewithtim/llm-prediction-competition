# Plan: Auto-Bump Bet to Minimum Size on `order_too_small`

**Date:** 2026-03-05
**Status:** Complete

---

## Overview

When Polymarket rejects a bet with `order_too_small` (e.g. "invalid amount for a marketable BUY order ($0.3116), min size: $1"), the system currently treats it as a terminal error — no retry. Instead, we should extract the minimum size from the error message, bump the bet amount up to that minimum, and retry the order. The prediction should be annotated to record that the stake was auto-bumped, capturing the original stake, the new stake, and bankroll context.

---

## Approach

Handle the auto-bump inline in the **bet-retry service** rather than in the initial `placeBet` flow. When the retry service encounters a failed bet with `errorCategory === "order_too_small"`, it extracts the min size from the error message, bumps the bet amount, and retries with the new amount. This keeps the initial bet flow simple and leverages the existing retry infrastructure.

Key changes:
1. **Extract min size from error** — add a `extractMinBetSize(errorMessage)` function to `bet-errors.ts`
2. **Remove `order_too_small` from `TERMINAL_CATEGORIES`** — so the retry service picks it up
3. **Bump amount in retry** — when retrying an `order_too_small` bet, use the extracted min size instead of the original amount
4. **Update the bet's amount in the DB** — so the bet record reflects the actual amount placed
5. **Annotate the prediction** — add a nullable `stakeAdjustment` JSON column to the `predictions` table to record the bump
6. **Record in audit log** — capture the bump details in audit metadata

### Why retry-based instead of inline re-attempt

The initial `placeBet` flow is already complex. Adding inline retry-with-bump logic would create a second code path for order placement within the same function. The retry service already handles re-submission with all the right guards (wallet lookup, active-bet check, audit logging). Making `order_too_small` retryable is the minimal change.

### Trade-offs

- **One extra cycle delay**: the bet won't be re-placed immediately — it waits for the next retry interval (default 1 minute). This is acceptable since markets don't move that fast for sports betting.
- **Min size may change**: the extracted min size might not be current by retry time. If it fails again with a new min size, the retry will extract and bump again on the next attempt.
- **Adds config dependency to retry service**: the retry service needs `maxStakePerBet` to guard against bumping beyond what we're willing to stake. This is a small, focused addition.

---

## Changes Required

### `src/domain/services/bet-errors.ts`

Add a `extractMinBetSize` function that parses the minimum bet size from a Polymarket error message.

```typescript
export function extractMinBetSize(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const match = message.match(/min size:\s*\$?([\d.]+)/i);
  return match ? Number.parseFloat(match[1]) : null;
}
```

### `src/database/repositories/bets.ts`

1. Remove `"order_too_small"` from `TERMINAL_CATEGORIES` so it becomes retryable.
2. Add an `updateAmount` method to update a bet's amount (and recalculate shares):

```typescript
async updateAmount(id: string, newAmount: number) {
  const bet = await db.select().from(bets).where(eq(bets.id, id)).get();
  if (!bet) return;
  const newShares = newAmount / bet.price;
  return db
    .update(bets)
    .set({ amount: newAmount, shares: newShares })
    .where(eq(bets.id, id))
    .run();
},
```

### `src/domain/services/bet-retry.ts`

In the retry loop, before calling `placeOrder`, check if the bet's `errorCategory` is `"order_too_small"`. If so, extract the min bet size from `bet.errorMessage`, validate the bumped amount against `maxStakePerBet`, bump the amount, update the bet record, and use the new amount for the retry.

```typescript
import { extractMinBetSize } from "./bet-errors";

// Inside the retry loop, before the placeOrder call:
let retryAmount = bet.amount;

if (bet.errorCategory === "order_too_small" && bet.errorMessage) {
  const minSize = extractMinBetSize(bet.errorMessage);
  if (minSize && minSize > bet.amount) {
    // Guard: if bumped amount exceeds max stake, skip this retry entirely
    if (minSize > maxStakePerBet) {
      logger.warn("Bet retry: min bet size exceeds max stake, skipping", {
        betId: bet.id,
        minSize,
        maxStakePerBet,
      });
      result.errors.push(
        `Bet ${bet.id}: min size $${minSize} exceeds max stake $${maxStakePerBet}`,
      );
      continue;
    }

    retryAmount = minSize;
    await betsRepo.updateAmount(bet.id, retryAmount);

    // Annotate the prediction
    await predictionsRepo.addStakeAdjustment(bet.marketId, bet.competitorId, {
      originalStake: bet.amount,
      adjustedStake: retryAmount,
      reason: "min_bet_bump",
      minSizeFromError: minSize,
      adjustedAt: new Date().toISOString(),
    });
  }
}
```

The existing `retry_started` audit log call stays in place — its metadata is extended to include `stakeAdjustment` when a bump occurs:

```typescript
await auditLog.safeRecord({
  betId: bet.id,
  event: "retry_started",
  statusBefore: "failed",
  statusAfter: "submitting",
  metadata: {
    attempt: bet.attempts + 1,
    previousError: bet.errorMessage,
    ...(retryAmount !== bet.amount && {
      stakeAdjustment: {
        originalAmount: bet.amount,
        bumpedAmount: retryAmount,
        reason: "order_too_small",
        minSizeFromError: extractMinBetSize(bet.errorMessage),
      },
    }),
  },
});
```

Then use `retryAmount` in the `placeOrder` call:

```typescript
const { orderId } = await client.placeOrder({
  tokenId: bet.tokenId,
  price: bet.price,
  amount: retryAmount,
  side: "BUY",
});
```

### `src/database/schema.ts`

Add a nullable `stakeAdjustment` JSON column to the `predictions` table:

```typescript
stakeAdjustment: text("stake_adjustment", { mode: "json" }).$type<{
  originalStake: number;
  adjustedStake: number;
  reason: string;
  minSizeFromError: number;
  adjustedAt: string;
}>(),
```

### `src/database/repositories/predictions.ts`

Add an `addStakeAdjustment` method:

```typescript
async addStakeAdjustment(
  marketId: string,
  competitorId: string,
  adjustment: {
    originalStake: number;
    adjustedStake: number;
    reason: string;
    minSizeFromError: number;
    adjustedAt: string;
  },
) {
  return db
    .update(predictions)
    .set({ stakeAdjustment: adjustment })
    .where(
      and(
        eq(predictions.marketId, marketId),
        eq(predictions.competitorId, competitorId),
      ),
    )
    .run();
},
```

### `src/domain/services/bet-retry.ts` (dependency additions)

Add `predictionsRepo` and `maxStakePerBet` to the service dependencies:

```typescript
export function createBetRetryService(deps: {
  betsRepo: ReturnType<typeof betsRepoFactory>;
  bettingClientFactory: BettingClientFactory;
  auditLog: AuditLogRepo;
  predictionsRepo: ReturnType<typeof predictionsRepoFactory>;
  walletConfigs: Map<string, WalletConfig>;
  maxRetryAttempts: number;
  retryDelayMs?: number;
  maxStakePerBet: number;
}) {
```

### `src/index.ts`

Pass `predictionsRepo` and `maxStakePerBet` (from `config.betting.maxStakePerBet`) to `createBetRetryService`.

### `src/shared/api-types.ts`

Add `StakeAdjustment` type and include it in the prediction response type if one exists:

```typescript
export type StakeAdjustment = {
  originalStake: number;
  adjustedStake: number;
  reason: string;
  minSizeFromError: number;
  adjustedAt: string;
};
```

---

## Data & Migration

Add a new nullable column `stake_adjustment` (JSON text) to the `predictions` table. This is a non-breaking, additive migration — existing rows will have `NULL` for this column.

Generate via: `bunx drizzle-kit generate`

---

## Test Plan

### `tests/unit/domain/services/bet-errors.test.ts`

- `extractMinBetSize` returns 1 for "invalid amount for a marketable BUY order ($0.3116), min size: $1"
- `extractMinBetSize` returns 5 for "min size: $5.00"
- `extractMinBetSize` returns null for an unrelated error message
- `extractMinBetSize` returns null for null/undefined input

### `tests/unit/domain/services/bet-retry.test.ts` — unit tests

- Retries `order_too_small` bet with bumped amount extracted from error message
- Updates bet amount in DB before retrying
- Records stake adjustment on the prediction
- Audit log includes `stakeAdjustment` metadata for bumped bets
- Falls back to original amount if min size cannot be extracted from error
- Does not bump if extracted min size is less than or equal to original amount

### `tests/unit/domain/services/bet-retry.test.ts` — guard condition tests

- Skips retry when bumped min size exceeds `maxStakePerBet` (bet stays failed, error recorded)
- Does not call `placeOrder` or `updateAmount` when min size exceeds max stake
- Does not annotate prediction when min size exceeds max stake

### `tests/unit/domain/services/min-bet-bump-flow.test.ts` — full flow test

End-to-end flow test using real service instances with mocked external dependencies (BettingClient, BettingClientFactory). Tests the complete lifecycle:

1. **Happy path: place → order_too_small → retry → success**
   - Create a betting service and bet-retry service sharing the same mock `betsRepo`, `auditLog`, and `predictionsRepo`
   - Call `bettingService.placeBet()` with the mocked BettingClient configured to reject with `"invalid amount for a marketable BUY order ($0.31), min size: $1"`
   - Assert bet is created with status `"failed"`, errorCategory `"order_too_small"`
   - Reconfigure the mock BettingClient to succeed on the next call
   - Call `retryService.retryFailedBets()`
   - Assert `placeOrder` was called with `amount: 1` (the extracted min size, not the original `0.31`)
   - Assert bet amount in DB was updated to `1`
   - Assert prediction has `stakeAdjustment` annotation with `originalStake: 0.31`, `adjustedStake: 1`, `reason: "min_bet_bump"`
   - Assert audit log recorded both `order_failed` (original) and `retry_started` with stake adjustment metadata, then `retry_succeeded`

2. **Guard: min bet exceeds max stake → stays failed**
   - Place bet → `order_too_small` with `min size: $50`
   - Configure retry service with `maxStakePerBet: 10`
   - Call `retryService.retryFailedBets()`
   - Assert `placeOrder` was NOT called
   - Assert bet stays `"failed"` (no status change)
   - Assert prediction has NO `stakeAdjustment` annotation
   - Assert result includes error message about min size exceeding max stake

3. **Guard: min size can't be parsed → retries with original amount**
   - Place bet → `order_too_small` with error message that doesn't contain a parseable min size (e.g. `"order size is too small"`)
   - Call `retryService.retryFailedBets()`
   - Assert `placeOrder` was called with the original bet amount (no bump)
   - Assert prediction has NO `stakeAdjustment` annotation

4. **Second failure with new min size → bumps again on next retry**
   - Place bet → `order_too_small` with `min size: $1`
   - First retry: BettingClient rejects again with `"invalid amount for a marketable BUY order ($1.00), min size: $2"`
   - Assert bet amount updated to `$1` on first retry, then updated to `$2` on second retry
   - Second retry: BettingClient succeeds
   - Assert final bet amount is `$2`

### `tests/unit/database/repositories/predictions.test.ts` (or add to existing)

- `addStakeAdjustment` updates the prediction with adjustment JSON
- `addStakeAdjustment` on non-existent prediction is a no-op

### `tests/unit/database/repositories/bets.test.ts` (or add to existing)

- `updateAmount` updates amount and recalculates shares
- `findRetryableBets` now returns `order_too_small` bets (no longer terminal)

---

## Task Breakdown

- [x] Add `extractMinBetSize` function to `src/domain/services/bet-errors.ts`
- [x] Add tests for `extractMinBetSize` in `tests/unit/domain/services/bet-errors.test.ts`
- [x] Remove `"order_too_small"` from `TERMINAL_CATEGORIES` in `src/database/repositories/bets.ts`
- [x] Add `updateAmount` method to `src/database/repositories/bets.ts`
- [x] Add `stakeAdjustment` column to `predictions` table in `src/database/schema.ts`
- [x] Generate migration with `bunx drizzle-kit generate`
- [x] Add `addStakeAdjustment` method to `src/database/repositories/predictions.ts`
- [x] Add `StakeAdjustment` type to `src/shared/api-types.ts`
- [x] Add `predictionsRepo` and `maxStakePerBet` dependencies to `createBetRetryService` in `src/domain/services/bet-retry.ts`
- [x] Implement auto-bump logic with max-stake guard in the retry loop in `src/domain/services/bet-retry.ts`
- [x] Wire `predictionsRepo` and `maxStakePerBet` to `createBetRetryService` in `src/index.ts`
- [x] Update existing bet-retry tests to pass `predictionsRepo` and `maxStakePerBet` mocks
- [x] Add bet-retry unit tests for auto-bump behaviour (bump amount, update DB, annotate prediction, audit metadata)
- [x] Add bet-retry unit tests for guard conditions (min size exceeds max stake → skip)
- [x] Add full flow test in `tests/unit/domain/services/min-bet-bump-flow.test.ts` — happy path: place → order_too_small → retry bumps → success
- [x] Add full flow test — guard: min bet exceeds max stake → stays failed
- [x] Add full flow test — guard: min size unparseable → retries with original amount
- [x] Add full flow test — second failure with new min size → bumps again on next retry
- [x] Add `updateAmount` tests to bets repo tests
- [x] Add `addStakeAdjustment` tests to predictions repo tests
- [x] Add test that `findRetryableBets` returns `order_too_small` bets
- [x] Run type checker and lint, fix any issues
