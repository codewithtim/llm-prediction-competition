# Bet State Machine — Plan

## Current State

### Statuses defined

```typescript
// src/domain/models/prediction.ts:31
type BetStatus = "pending" | "filled" | "settled_won" | "settled_lost" | "cancelled";
```

### Current flow

```
                    Polymarket API call succeeds
LLM prediction ──────────────────────────────────► pending
                                                      │
                                                      │ (settlement loop, every 2h)
                                                      │ market resolved?
                                                      ▼
                                              settled_won / settled_lost
```

### What actually happens today

1. **Prediction pipeline** generates a prediction and saves it to DB.
2. `bettingService.placeBet()` validates (market open, no duplicate, exposure limit, wallet exists).
3. If validation passes and `dryRun` is false, it calls `bettingClient.placeOrder()` against the Polymarket CLOB API.
4. If the API call succeeds, a bet row is created with `status = "pending"`.
5. If the API call **throws**, the error is caught in `prediction-pipeline.ts:372-376`, logged, and the bet is skipped — **no bet row is ever created**.
6. Settlement loop queries all `pending` and `filled` bets. When a market resolves (price >= 0.99), the bet transitions directly to `settled_won` or `settled_lost`.

### Problems

| Problem | Details |
|---------|---------|
| **No failed state** | If Polymarket returns an error (insufficient funds, invalid token, network timeout), no bet record exists. There is no visibility into what failed or why. The prediction exists but the bet silently vanishes. |
| **"pending" is ambiguous** | A bet in `pending` means "order submitted to CLOB" but we never confirm whether it actually filled. Polymarket GTC orders can sit unfilled if the price moves. `pending` conflates "submitted" with "filled on-chain". |
| **No order confirmation** | There is no polling of Polymarket to check whether a pending order actually filled, partially filled, or expired. The `filled` status exists in the schema but nothing ever transitions a bet to it. |
| **"cancelled" is unused** | Defined in the type but never written anywhere in the codebase. |
| **No retry mechanism** | Transient errors (network blip, rate limit) are treated the same as terminal errors (insufficient funds). There is no way to retry. |
| **Duplicate check has a gap** | The duplicate check in `betting.ts:65-71` queries for existing `pending`/`filled` bets. But if a bet API call fails (no row created), the next pipeline run will try again — which is good for transient errors but could double-bet if the first call actually succeeded server-side but the response was lost. |
| **Locking is process-level only** | The scheduler uses boolean flags (`predictionRunning`) to prevent concurrent pipeline runs within a single process. There is no database-level locking, so multiple app instances would race. |

---

## Proposed State Machine

### New statuses

```
"submitting" | "pending" | "filled" | "failed" | "cancelled" | "settled_won" | "settled_lost"
```

### State diagram

```
                         ┌──────────────────────────────────────────────┐
                         │                                              │
                         ▼                                              │
LLM prediction ──► submitting ──┬──► pending ──► filled ──┬──► settled_won
                                │                         │
                                │                         └──► settled_lost
                                │
                                └──► failed (terminal or retryable)
                                       │
                                       │ (if retryable + attempts < max)
                                       │
                                       └──► submitting (retry)

                   pending ──► cancelled  (if we cancel an unfilled order)
```

### Status definitions

| Status | Meaning | Terminal? |
|--------|---------|-----------|
| `submitting` | Bet row created in DB; Polymarket API call in flight. Acts as a lock to prevent duplicates. | No |
| `pending` | Polymarket accepted the order (we have an `orderId`). Order may not yet be filled on-chain. | No |
| `filled` | Order confirmed filled (via Polymarket order status check). Capital is committed. | No |
| `failed` | Bet placement failed. Row includes `errorMessage` and `errorCategory` for diagnosis. | Yes (unless retryable) |
| `cancelled` | Order was cancelled (by us or by Polymarket — e.g. market closed before fill). | Yes |
| `settled_won` | Market resolved, bet won. | Yes |
| `settled_lost` | Market resolved, bet lost. | Yes |

### Error categories

```typescript
type BetErrorCategory =
  | "insufficient_funds"   // terminal — bankroll exhausted
  | "invalid_market"       // terminal — bad token ID, market delisted
  | "wallet_error"         // terminal — signing failure, bad credentials
  | "network_error"        // retryable — timeout, 5xx, connection reset
  | "rate_limited"         // retryable — 429 from CLOB
  | "unknown";             // retryable once, then terminal
```

---

## Implementation Plan

### 1. Add new columns to `bets` table

**File:** `src/infrastructure/database/schema.ts`

Add to the `bets` table:
- `errorMessage: text("error_message")` — human-readable error from the API
- `errorCategory: text("error_category")` — one of the error categories above
- `attempts: integer("attempts").notNull().default(1)` — number of placement attempts
- `lastAttemptAt: integer("last_attempt_at", { mode: "timestamp" })` — when last attempt was made

Update the `status` enum to include `"submitting"` and `"failed"`.

Generate a Drizzle migration for the schema change.

### 2. Update domain types

**File:** `src/domain/models/prediction.ts`

```typescript
export type BetStatus =
  | "submitting"
  | "pending"
  | "filled"
  | "failed"
  | "cancelled"
  | "settled_won"
  | "settled_lost";

export type BetErrorCategory =
  | "insufficient_funds"
  | "invalid_market"
  | "wallet_error"
  | "network_error"
  | "rate_limited"
  | "unknown";
```

Update the `Bet` type to include `errorMessage`, `errorCategory`, `attempts`.

### 3. Update bets repository

**File:** `src/infrastructure/database/repositories/bets.ts`

- Update `findByStatus` signature to accept new statuses.
- Add `markFailed(id, errorMessage, errorCategory)` method.
- Add `findRetryable()` — returns failed bets where category is retryable and `attempts < maxRetries`.
- Update `updateStatus` to also handle `submitting` and `failed`.

### 4. Refactor `placeBet` — write-ahead pattern

**File:** `src/domain/services/betting.ts`

The key change: **create the bet row before calling the Polymarket API**. This acts as a lock and provides an audit trail.

New flow:
1. Run all existing validations (market open, duplicate check, exposure limit, wallet).
2. **Insert bet row with `status = "submitting"`** — this is the lock. Any concurrent run will see this row in the duplicate check and skip.
3. Call `bettingClient.placeOrder()` inside a try/catch.
4. **On success:** update row to `status = "pending"`, set `orderId`.
5. **On failure:** classify the error, update row to `status = "failed"` with `errorMessage` and `errorCategory`.

Update the duplicate check (`betting.ts:65-71`) to also consider `submitting` and `failed` (non-retryable) statuses.

### 5. Add error classification

**New file:** `src/domain/services/bet-errors.ts`

A function that takes an `Error` from the Polymarket client and returns a `BetErrorCategory`:

```typescript
function classifyBetError(error: Error): BetErrorCategory {
  const msg = error.message.toLowerCase();
  if (msg.includes("insufficient") || msg.includes("balance"))
    return "insufficient_funds";
  if (msg.includes("timeout") || msg.includes("ECONNREFUSED") || msg.includes("5"))
    return "network_error";
  if (msg.includes("429") || msg.includes("rate"))
    return "rate_limited";
  if (msg.includes("invalid") || msg.includes("not found"))
    return "invalid_market";
  if (msg.includes("signature") || msg.includes("key") || msg.includes("nonce"))
    return "wallet_error";
  return "unknown";
}
```

This will need refinement as we observe real Polymarket error shapes, but gives us a starting classification.

### 6. Add order confirmation polling

**New file:** `src/domain/services/order-confirmation.ts`

A service that runs on an interval (or is called from the settlement loop) to check the status of `pending` bets:

1. Fetch all bets with `status = "pending"`.
2. For each, call `bettingClient.getOpenOrders()` (already exists on the client) or query the Polymarket API for order status.
3. If order is filled → update to `status = "filled"`.
4. If order no longer exists and not filled → update to `status = "cancelled"`.
5. If order is still open → leave as `pending`.

This closes the gap where we never confirm fills.

### 7. Add retry mechanism

**New file:** `src/domain/services/bet-retry.ts`

A service that can be called on a schedule:

1. Query `betsRepo.findRetryable()` — failed bets with retryable category and `attempts < 3`.
2. For each retryable bet:
   - Set status back to `submitting`, increment `attempts`.
   - Re-call the Polymarket API.
   - On success → `pending`. On failure → `failed` again with updated error.
3. After max retries, the bet stays in `failed` as terminal.

Config:
```typescript
betting: {
  maxRetries: 3,
  retryDelayMs: 60_000,  // minimum time between retry attempts
}
```

### 8. Integrate into scheduler

**File:** `src/orchestrator/scheduler.ts`

Add two new scheduled tasks alongside the existing three:

- **Order confirmation** — runs every 5 minutes. Checks pending orders for fills.
- **Bet retry** — runs every 10 minutes. Retries failed-retryable bets.

Both get the same boolean-flag locking pattern as the existing tasks.

### 9. Update settlement service

**File:** `src/domain/services/settlement.ts`

- Settlement should only settle `filled` bets (not `pending` — those haven't been confirmed on-chain).
- For `pending` bets that have been pending longer than a threshold (e.g. 24 hours), the order confirmation service should check and either fill or cancel them. Settlement should not settle unconfirmed orders.
- Keep settling `pending` bets as a fallback for the transition period (existing bets in DB), but log a warning.

### 10. Update bankroll calculation

**File:** `src/domain/services/bankroll.ts`

Update exposure calculation to account for new statuses:
- `submitting` = locked capital (count toward exposure)
- `pending` = locked capital
- `filled` = locked capital
- `failed` = **not** locked (capital is released)
- `cancelled` = **not** locked

### 11. Update duplicate check

**File:** `src/domain/services/betting.ts`

The duplicate check should prevent betting on the same market+competitor if there is an existing bet in any of: `submitting`, `pending`, `filled`. Failed-terminal and cancelled bets should **not** block a new bet attempt.

### 12. Update UI/API

Any API routes or dashboard views that display bet status should handle the new statuses:
- Show `submitting` as "Placing..."
- Show `failed` with the error message for operator visibility
- Show `cancelled` distinctly from failed

---

## Migration Strategy

1. Add new columns with defaults (`attempts = 1`, nullable `errorMessage`/`errorCategory`).
2. Add `submitting` and `failed` to the status enum.
3. Existing `pending` bets in the DB remain valid — they were submitted before this change, so they are legitimately pending.
4. No data migration needed; new statuses only apply to future bets.

## Summary of changes by file (steps 1–12)

| File | Change |
|------|--------|
| `src/infrastructure/database/schema.ts` | Add columns, update status enum |
| `src/domain/models/prediction.ts` | Add `BetErrorCategory`, update `BetStatus` and `Bet` types |
| `src/infrastructure/database/repositories/bets.ts` | Add `markFailed`, `findRetryable`, update signatures |
| `src/domain/services/betting.ts` | Write-ahead pattern, update duplicate check |
| `src/domain/services/bet-errors.ts` | **New** — error classification |
| `src/domain/services/order-confirmation.ts` | **New** — poll Polymarket for order fills |
| `src/domain/services/bet-retry.ts` | **New** — retry failed-retryable bets |
| `src/domain/services/settlement.ts` | Prefer settling `filled` bets only |
| `src/domain/services/bankroll.ts` | Update exposure for new statuses |
| `src/orchestrator/scheduler.ts` | Add confirmation + retry intervals |
| `src/orchestrator/config.ts` | Add `maxRetries`, `retryDelayMs`, new interval configs |
| Drizzle migration | Schema migration file |

---

## Post-Implementation: Production Bug Fixes

Steps 1–12 were implemented and all 436 tests passed. However, in production bets were stuck in `pending` even when Polymarket rejected them (e.g. insufficient funds). Three bugs were found and fixed.

### Bug 1: `placeOrder` silently swallowed API failures

**File:** `src/infrastructure/polymarket/betting-client.ts`

**Root cause:** The CLOB client's `createAndPostOrder` defaults `throwOnError: false`. On HTTP 400 errors (e.g. insufficient funds), instead of throwing, it catches the error internally, logs `[CLOB Client] request error`, and returns the error data:

```typescript
// Actual CLOB client return on failure (from node_modules source):
{ error: "not enough balance / allowance", status: 400 }
```

Our code blindly extracted an orderId from the response:
```typescript
return { orderId: response?.orderID ?? response?.id ?? String(response) };
// With error response: response?.orderID → undefined, response?.id → undefined
// String({ error: "...", status: 400 }) → "[object Object]"
// Result: orderId = "[object Object]" — bet goes to pending with a garbage orderId
```

**Initial wrong fix:** Checked for `response.success === false`. This field doesn't exist on CLOB error responses — the error format uses an `error` field, not `success`.

**Correct fix:** Two-layer validation:
1. Check for the actual CLOB error format: if response has an `error` field, throw with that message.
2. Validate a real `orderID` string exists in the response — throw if missing/invalid.

```typescript
// Check for CLOB error response { error: string, status: number }
if (response && typeof response === "object" && "error" in response) {
  const errObj = response as { error?: string; status?: number };
  throw new Error(errObj.error ?? `Order rejected (HTTP ${errObj.status ?? "unknown"})`);
}

// Validate we got a real order ID back
const orderId = response?.orderID ?? response?.id;
if (!orderId || typeof orderId !== "string") {
  throw new Error(`Order rejected (no orderID in response: ${String(response)})`);
}
```

### Bug 2: Order confirmation wrongly marked ghost orders as "filled"

**File:** `src/domain/services/order-confirmation.ts`

**Root cause:** Bets with orderId `"[object Object]"` (from Bug 1) didn't appear in the open orders list. The confirmation service assumed "not in open orders = filled" and marked them as `filled`. But they were never actually placed — they're ghost orders.

**Fix:** Before checking open orders, detect bets with invalid orderId values and immediately mark them as `failed`. This catches both empty strings and the `"[object Object]"`/`"undefined"` garbage values from the old code path:

```typescript
const isGhostOrder =
  !bet.orderId ||
  bet.orderId === "[object Object]" ||
  bet.orderId === "undefined" ||
  bet.orderId === "null";
if (isGhostOrder) {
  await betsRepo.updateBetAfterSubmission(bet.id, {
    status: "failed",
    errorMessage: `Order was never placed (invalid orderId: ${JSON.stringify(bet.orderId)})`,
    errorCategory: "unknown",
    attempts: bet.attempts + 1,
    lastAttemptAt: new Date(),
  });
  continue;
}
```

### Bug 3: Services never wired up in `src/index.ts`

**File:** `src/index.ts`

**Root cause:** `orderConfirmationService` and `betRetryService` were never instantiated. The scheduler accepts them as optional deps, so TypeScript didn't complain. The confirmation and retry loops never started — pending bets were never checked.

**Fix:** Built a `walletConfigs` map from the loaded competitor engines, instantiated both services, and passed them to the scheduler:

```typescript
const walletConfigs = new Map();
for (const entry of engines) {
  if (entry.walletConfig) {
    walletConfigs.set(entry.competitorId, entry.walletConfig);
  }
}

const orderConfirmationService = createOrderConfirmationService({ ... });
const betRetryService = createBetRetryService({ ... });

const scheduler = createScheduler({
  ...,
  orderConfirmationService,
  betRetryService,
  ...
});
```

### Summary of bug fix changes

| File | Change |
|------|--------|
| `src/infrastructure/polymarket/betting-client.ts` | Check for CLOB error format `{ error, status }` + validate orderID exists |
| `src/domain/services/order-confirmation.ts` | Detect ghost orders (empty/garbage orderId) → mark as `failed` |
| `src/index.ts` | Instantiate `orderConfirmationService` + `betRetryService`, pass to scheduler |
| `tests/unit/infrastructure/polymarket/betting-client.test.ts` | Tests for CLOB error response, missing orderID, undefined response |
| `tests/unit/domain/services/order-confirmation.test.ts` | Tests for empty orderId and `[object Object]` orderId → failed |

---

## Post-Implementation: Dashboard Fixes

### P&L calculation excluded failed/cancelled bets

**File:** `src/infrastructure/database/repositories/bets.ts`

**Problem:** `getPerformanceStats` summed `amount` across ALL bets for `totalStaked`, including failed and cancelled bets. With 10 failed $5 bets: totalStaked=$50, totalReturned=$0, profitLoss=-$50. But that money was never actually spent.

**Fix:** `totalStaked` and `totalReturned` now only include settled bets (`settled_won`/`settled_lost`). Added `failed` count and `lockedAmount` (sum of amounts in pending + filled bets).

### New dashboard widgets and status badge

**Files:** `ui/src/components/dashboard/stats-cards.tsx`, `ui/src/components/shared/status-badge.tsx`, `src/shared/api-types.ts`, `src/api/routes/dashboard.ts`, `src/api/routes/competitors.ts`

Dashboard expanded from 4 to 6 stat cards:

| Widget | Description |
|--------|-------------|
| **Settled P&L** | Profit/loss from settled bets only (green/red) |
| **Locked in Bets** | Dollar amount in pending + filled orders (amber when > 0) |
| **Accuracy** | Win rate from settled bets |
| **Active Markets** | Currently active Polymarket markets |
| **Pending Bets** | Orders awaiting fill/confirmation |
| **Failed Bets** | Count of failed bets (red when > 0) |

Added `failed` status to the UI status badge color map (red, matching `settled_lost` and `error`).

Added `failed`, `lockedAmount` to `PerformanceStatsDTO` and `failedBets`, `lockedAmount` to `DashboardResponse`. Both the dashboard and competitors API routes pass through the new fields.

### Summary of dashboard changes

| File | Change |
|------|--------|
| `src/infrastructure/database/repositories/bets.ts` | P&L only from settled bets; added `failed` count, `lockedAmount` |
| `src/shared/api-types.ts` | Added `failed`, `lockedAmount` to `PerformanceStatsDTO`; `failedBets`, `lockedAmount` to `DashboardResponse` |
| `src/api/routes/dashboard.ts` | Pass through new stats fields, aggregate `failedBets` and `lockedAmount` |
| `src/api/routes/competitors.ts` | Pass through new stats fields |
| `ui/src/components/dashboard/stats-cards.tsx` | 6-card layout with Locked in Bets + Failed Bets widgets |
| `ui/src/components/shared/status-badge.tsx` | Added `failed` status with red color |
| `tests/unit/infrastructure/database/repositories/bets.test.ts` | Tests for failed bet exclusion from P&L, lockedAmount calculation |
| `tests/unit/api/helpers.ts` | Updated mock to include new `failed`, `lockedAmount` fields |
