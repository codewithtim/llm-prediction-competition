# Plan: Double Bet Prevention

**Date:** 2026-03-03
**Status:** Draft

---

## Overview

The betting system has application-level duplicate detection (`BLOCKING_STATUSES` check in `placeBet`) but no database-level constraint and no atomicity between checking and inserting. The retry service has no duplicate check at all — it trusts that only one bet row exists per market+competitor. This plan closes both gaps: atomic check-and-create in the betting service, a pre-retry active-bet check in the retry service, and a partial unique index as a DB-level safety net.

---

## Approach

Three layers of protection, each independent:

### 1. Atomic check-and-create via Drizzle transaction (betting service)

The current `placeBet` flow is:
```
1. findByCompetitor(competitorId)           ← READ
2. check for duplicate in results           ← APPLICATION LOGIC
3. betsRepo.create({...})                   ← WRITE
```

Between steps 1 and 3, another async operation can interleave (e.g. the retry service transitioning a failed bet to "submitting"). The fix is a new repository method `createIfNoActiveBet` that wraps the check-and-insert in a single SQLite transaction. SQLite transactions provide serializable isolation — the check and insert become atomic.

```typescript
async createIfNoActiveBet(bet: typeof bets.$inferInsert): Promise<"created" | "duplicate"> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: bets.id })
      .from(bets)
      .where(
        and(
          eq(bets.marketId, bet.marketId!),
          eq(bets.competitorId, bet.competitorId!),
          inArray(bets.status, ["submitting", "pending", "filled"]),
        ),
      )
      .get();

    if (existing) return "duplicate";

    await tx.insert(bets).values(bet).run();
    return "created";
  });
}
```

The betting service replaces `betsRepo.create(...)` with `betsRepo.createIfNoActiveBet(...)` and handles the `"duplicate"` return.

The existing `findByCompetitor` call and exposure calculation remain outside the transaction — they're still useful for the early-return skip path and exposure check. The transaction is the safety net that makes the final check-and-write atomic.

### 2. Pre-retry active-bet check (retry service)

Before retrying a failed bet, the retry service should verify that no other active bet (submitting/pending/filled) already exists for the same market+competitor. This covers the scenario where:
1. Bet fails → gets queued for retry
2. A new prediction run places a fresh bet for the same market
3. Retry service picks up the old failed bet and retries it → double bet

A new repo method `hasActiveBetForMarket(marketId, competitorId)` returns a boolean. The retry service calls it before each retry and skips if true.

### 3. Partial unique index (DB safety net)

A SQLite partial unique index prevents two active bets at the database level, even if the application logic has a bug:

```sql
CREATE UNIQUE INDEX idx_bets_active_market_competitor
ON bets(market_id, competitor_id)
WHERE status IN ('submitting', 'pending', 'filled');
```

This is a belt-and-suspenders approach. The application logic should never hit the constraint, but if it does, the insert fails with a UNIQUE constraint error instead of silently creating a duplicate.

### Why this structure

**Transactions are the right primitive.** SQLite serializable transactions make check-and-insert atomic without external locking libraries or advisory locks. Drizzle supports `db.transaction()` with libSQL.

**The retry check is separate from the transaction.** The retry service doesn't create new bet rows — it updates existing ones. A transaction around the retry wouldn't help because the problem is checking whether a *different* bet row is active. A simple boolean check before the retry is sufficient.

**The unique index is a safety net, not the primary mechanism.** Relying solely on a unique index would mean catching constraint violation errors and treating them as "skip" — that works but is ugly. The application logic handles it cleanly; the index catches bugs.

### Trade-offs

- **Transaction overhead is negligible.** SQLite transactions on a single table with a WHERE clause on indexed columns are microseconds. The Polymarket API call (seconds) dominates latency.
- **The partial index only covers active statuses.** Bets in terminal states (failed, cancelled, settled_won, settled_lost) are allowed to have duplicates on the same market+competitor — this is correct, since a settled bet shouldn't block future bets on the same market.
- **The retry service's pre-check has a small TOCTOU window.** Between checking `hasActiveBetForMarket` and calling `updateStatus(bet.id, "submitting")`, another process could theoretically create an active bet. In practice this can't happen — the prediction pipeline checks for existing predictions first, and the scheduler prevents concurrent retry runs. The partial unique index catches this if it ever does happen.

---

## Changes Required

### `src/infrastructure/database/repositories/bets.ts`

Add two new methods:

**`createIfNoActiveBet(bet)`** — Atomic check-and-create within a transaction. Returns `"created"` or `"duplicate"`.

```typescript
import { and, eq, inArray } from "drizzle-orm";

async createIfNoActiveBet(bet: typeof bets.$inferInsert): Promise<"created" | "duplicate"> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: bets.id })
      .from(bets)
      .where(
        and(
          eq(bets.marketId, bet.marketId!),
          eq(bets.competitorId, bet.competitorId!),
          inArray(bets.status, ["submitting", "pending", "filled"]),
        ),
      )
      .get();

    if (existing) return "duplicate";

    await tx.insert(bets).values(bet).run();
    return "created";
  });
},
```

**`hasActiveBetForMarket(marketId, competitorId)`** — Boolean check for any active bet on a market+competitor pair.

```typescript
async hasActiveBetForMarket(marketId: string, competitorId: string): Promise<boolean> {
  const row = await db
    .select({ id: bets.id })
    .from(bets)
    .where(
      and(
        eq(bets.marketId, marketId),
        eq(bets.competitorId, competitorId),
        inArray(bets.status, ["submitting", "pending", "filled"]),
      ),
    )
    .get();

  return row !== undefined;
},
```

The existing `findByCompetitor` is kept (used for exposure calculation) but is no longer the duplicate-check mechanism.

Add `inArray` to the drizzle-orm import.

### `src/domain/services/betting.ts`

Replace the write-ahead `betsRepo.create(...)` call with `betsRepo.createIfNoActiveBet(...)`. Handle the `"duplicate"` return:

```typescript
// Replace lines 119-124:
// Before:
await betsRepo.create({
  ...bet,
  orderId: null,
  status: "submitting" as const,
});

// After:
const createResult = await betsRepo.createIfNoActiveBet({
  ...bet,
  orderId: null,
  status: "submitting" as const,
});
if (createResult === "duplicate") {
  return { status: "skipped", reason: "Bet already exists for this market and competitor" };
}
```

The existing `findByCompetitor` + `BLOCKING_STATUSES` check (lines 71-78) stays as an early-return optimisation — it avoids the transaction overhead when we can cheaply detect the duplicate. The transaction is the authoritative check.

### `src/domain/services/bet-retry.ts`

Add a `betsRepo.hasActiveBetForMarket()` check before each retry:

```typescript
// Inside the for loop, before the write-ahead updateStatus:
const alreadyActive = await betsRepo.hasActiveBetForMarket(bet.marketId, bet.competitorId);
if (alreadyActive) {
  logger.info("Bet retry: skipped — active bet already exists for market", {
    betId: bet.id,
    marketId: bet.marketId,
    competitorId: bet.competitorId,
  });
  continue;
}
```

This prevents retrying a failed bet when a newer bet for the same market+competitor is already active.

### Migration: `drizzle/XXXX_<name>.sql`

Add the partial unique index:

```sql
CREATE UNIQUE INDEX idx_bets_active_market_competitor
ON bets(market_id, competitor_id)
WHERE status IN ('submitting', 'pending', 'filled');
```

Generate via `bunx drizzle-kit generate` after updating the schema, or write the migration manually.

### `src/infrastructure/database/schema.ts`

No schema change is strictly needed — the migration can be a custom SQL file. However, if Drizzle supports partial indexes declaratively, it would be better to keep schema and migrations in sync. Drizzle's `sqliteTable` doesn't support partial indexes in the table definition, so the index is added via a manual migration only.

---

## Data & Migration

One migration file adding a partial unique index. Before applying:

- Any existing duplicate active bets in the database must be resolved. A pre-migration check query:
  ```sql
  SELECT market_id, competitor_id, COUNT(*) as cnt
  FROM bets
  WHERE status IN ('submitting', 'pending', 'filled')
  GROUP BY market_id, competitor_id
  HAVING cnt > 1;
  ```
  If any rows are returned, the duplicates must be manually resolved (mark extras as cancelled/failed) before the migration can apply. In practice, this is unlikely since the app has been running with the application-level check.

---

## Test Plan

### Bets repository tests (`tests/unit/infrastructure/database/repositories/bets.test.ts`)

1. **`createIfNoActiveBet` creates bet when no active bet exists** — Insert a bet for market M1 + competitor C1. Verify return is `"created"` and bet exists in DB.

2. **`createIfNoActiveBet` returns duplicate when submitting bet exists** — Create a bet with status "submitting" for M1+C1. Call `createIfNoActiveBet` for same M1+C1. Verify return is `"duplicate"` and only one bet exists.

3. **`createIfNoActiveBet` returns duplicate when pending bet exists** — Same as above with "pending" status.

4. **`createIfNoActiveBet` returns duplicate when filled bet exists** — Same as above with "filled" status.

5. **`createIfNoActiveBet` allows bet when existing bet is failed** — Create a bet with status "failed" for M1+C1. Call `createIfNoActiveBet` for same M1+C1. Verify return is `"created"`.

6. **`createIfNoActiveBet` allows bet when existing bet is settled** — Create a bet with status "settled_won" for M1+C1. Verify new bet is created.

7. **`createIfNoActiveBet` allows bet for different market** — Active bet on M1+C1. New bet on M2+C1. Verify return is `"created"`.

8. **`createIfNoActiveBet` allows bet for different competitor** — Active bet on M1+C1. New bet on M1+C2. Verify return is `"created"`.

9. **`hasActiveBetForMarket` returns true when active bet exists** — Create submitting bet. Verify returns true.

10. **`hasActiveBetForMarket` returns false when no bet exists** — Empty table. Verify returns false.

11. **`hasActiveBetForMarket` returns false when only failed bets exist** — Create failed bet. Verify returns false.

### Betting service tests (`tests/unit/domain/services/betting.test.ts`)

12. **`placeBet` returns skipped when `createIfNoActiveBet` returns duplicate** — Mock `createIfNoActiveBet` to return `"duplicate"`. Verify bet is skipped and API is never called.

13. **`placeBet` proceeds when `createIfNoActiveBet` returns created** — Mock `createIfNoActiveBet` to return `"created"`. Verify API is called and bet is placed.

### Bet retry service tests (`tests/unit/domain/services/bet-retry.test.ts`)

14. **Retry skips bet when active bet exists for same market** — Mock `hasActiveBetForMarket` to return true. Verify bet is not retried, `updateStatus` not called, and API not called.

15. **Retry proceeds when no active bet exists for market** — Mock `hasActiveBetForMarket` to return false. Verify bet is retried normally.

### Partial unique index test (`tests/unit/infrastructure/database/repositories/bets.test.ts`)

16. **DB rejects duplicate active bet via unique index** — After migration, directly insert two bets with same market+competitor and active status. Verify second insert throws a constraint error.

---

## Task Breakdown

- [x] Add `inArray` to drizzle-orm imports in `src/infrastructure/database/repositories/bets.ts`
- [x] Add `createIfNoActiveBet(bet)` method to bets repo
- [x] Add `hasActiveBetForMarket(marketId, competitorId)` method to bets repo
- [x] Replace `betsRepo.create(...)` with `betsRepo.createIfNoActiveBet(...)` in `src/domain/services/betting.ts` and handle `"duplicate"` return
- [x] Add `hasActiveBetForMarket` check before retry in `src/domain/services/bet-retry.ts`
- [x] Write migration for partial unique index `idx_bets_active_market_competitor`
- [x] Check for existing duplicate active bets in production DB before applying migration
- [x] Add `createIfNoActiveBet` tests to bets repo test file (tests 1-8)
- [x] Add `hasActiveBetForMarket` tests to bets repo test file (tests 9-11)
- [x] Update betting service tests for `createIfNoActiveBet` (tests 12-13)
- [x] Add retry service tests for active bet skip (tests 14-15)
- [x] Add unique index constraint test (test 16)
- [x] Run full test suite, type check, and lint
