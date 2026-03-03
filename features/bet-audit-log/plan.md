# Plan: Bet Audit Log

**Date:** 2026-03-03
**Status:** Draft

---

## Overview

Add an append-only audit log table that records every status change and external interaction for bets. Every time a bet's status transitions, an order is placed/cancelled on Polymarket, or a retry/settlement occurs, a row is inserted into `bet_audit_log`. This gives a complete timeline of each bet's lifecycle — what happened, when, and why — without modifying the existing `bets` table or service return types.

---

## Approach

**Insert-only audit rows at each status transition point.** Rather than trying to derive history from the bets table (which only stores current state), we record each transition as it happens. The audit log is a new table + repository, and each service that mutates bet state gets a `auditLog` dependency injected.

The audit log is written **alongside** the existing bet mutations, not as a replacement. If the audit write fails, the bet operation still succeeds (log failure is warn-logged, not thrown). This keeps the audit log non-blocking — it can never break bet placement.

### Event types to capture

Every bet status change and external API interaction:

| Event | Where it happens | What to capture |
|-------|------------------|-----------------|
| `bet_created` | `betting.ts` — write-ahead `betsRepo.create()` | Full bet details, market price, stake |
| `order_submitted` | `betting.ts` — after `placeOrder()` succeeds | orderId from CLOB |
| `order_failed` | `betting.ts` — `placeOrder()` catch block | Error message, error category |
| `order_confirmed` | `order-confirmation.ts` — pending → filled | orderId |
| `order_cancelled` | `order-confirmation.ts` — stale order cancelled | orderId, age when cancelled |
| `stuck_bet_recovered` | `order-confirmation.ts` — submitting → failed | Age stuck, recovery reason |
| `ghost_order_detected` | `order-confirmation.ts` — invalid orderId → failed | Invalid orderId value |
| `retry_started` | `bet-retry.ts` — submitting before retry | Attempt number, previous error |
| `retry_succeeded` | `bet-retry.ts` — retry `placeOrder()` succeeds | New orderId, attempt number |
| `retry_failed` | `bet-retry.ts` — retry `placeOrder()` fails | Error message, error category, attempt |
| `bet_settled` | `settlement.ts` — filled → settled_won/lost | Outcome, profit, winning side |

### Why this approach over alternatives

**Alternative A: Trigger-based (DB triggers on bets table).** SQLite supports triggers, but Drizzle ORM doesn't expose them ergonomically, and Turso remote DB complicates trigger creation. Triggers also can't capture context (e.g. which service caused the change, the orderId returned from an API call). Rejected.

**Alternative B: Wrap `betsRepo` with a proxy.** Intercept all betsRepo calls and automatically log. Sounds clean but misses context — `updateStatus` doesn't know why it was called (settlement vs cancellation vs confirmation). The caller has the context. Rejected.

**Chosen: Explicit audit calls at each transition point.** Slightly more code, but each call site provides full context (event type, error details, orderId, etc.). Makes the audit log maximally useful for debugging.

### Trade-offs

- **More code in each service** — each status transition gets an `auditLog.record()` call alongside the existing repo call. ~1 extra line per transition.
- **Audit writes are fire-and-forget** — if the audit log write fails (e.g. DB issue), we log a warning but don't fail the bet operation. This means the audit log could have gaps in extreme failure scenarios.
- **Storage growth** — each bet generates 2–4 audit rows over its lifetime. With the current volume (tens of bets per day), this is negligible. No cleanup or rotation needed.

---

## Changes Required

### `src/infrastructure/database/schema.ts`

Add the `bet_audit_log` table:

```typescript
export const betAuditLog = sqliteTable("bet_audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  betId: text("bet_id").notNull().references(() => bets.id),
  event: text("event", {
    enum: [
      "bet_created",
      "order_submitted",
      "order_failed",
      "order_confirmed",
      "order_cancelled",
      "stuck_bet_recovered",
      "ghost_order_detected",
      "retry_started",
      "retry_succeeded",
      "retry_failed",
      "bet_settled",
    ],
  }).notNull(),
  statusBefore: text("status_before", {
    enum: ["submitting", "pending", "filled", "settled_won", "settled_lost", "cancelled", "failed"],
  }),
  statusAfter: text("status_after", {
    enum: ["submitting", "pending", "filled", "settled_won", "settled_lost", "cancelled", "failed"],
  }).notNull(),
  orderId: text("order_id"),
  error: text("error"),
  errorCategory: text("error_category", {
    enum: ["insufficient_funds", "network_error", "rate_limited", "wallet_error", "invalid_market", "unknown"],
  }),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
```

The `metadata` JSON column captures event-specific details (profit, attempt number, age, etc.) without needing a column for every possible field.

### `src/infrastructure/database/repositories/audit-log.ts`

New repository file:

```typescript
export function auditLogRepo(db: Database) {
  return {
    async record(entry: typeof betAuditLog.$inferInsert) {
      return db.insert(betAuditLog).values(entry).run();
    },

    async findByBetId(betId: string) {
      return db.select().from(betAuditLog)
        .where(eq(betAuditLog.betId, betId))
        .orderBy(betAuditLog.timestamp)
        .all();
    },

    async findRecent(limit: number) {
      return db.select().from(betAuditLog)
        .orderBy(desc(betAuditLog.timestamp))
        .limit(limit)
        .all();
    },
  };
}
```

### `src/domain/services/betting.ts`

Add `auditLog` to deps. Record two events:

1. After `betsRepo.create()` (write-ahead) — `bet_created` with `statusAfter: "submitting"`.
2. After `betsRepo.updateBetAfterSubmission()` — either `order_submitted` (status → pending) or `order_failed` (status → failed).

Each audit call is wrapped in try/catch that logs a warning on failure.

```typescript
export function createBettingService(deps: {
  bettingClientFactory: BettingClientFactory;
  betsRepo: ReturnType<typeof betsRepoFactory>;
  auditLog: ReturnType<typeof auditLogRepoFactory>;
  config: BettingConfig;
}) {
```

### `src/domain/services/order-confirmation.ts`

Add `auditLog` to deps. Record events for:

1. Stuck submitting bet → failed: `stuck_bet_recovered`
2. Ghost order detected → failed: `ghost_order_detected`
3. Order filled (pending → filled): `order_confirmed`
4. Stale order cancelled (pending → cancelled): `order_cancelled`

### `src/domain/services/bet-retry.ts`

Add `auditLog` to deps. Record events for:

1. Retry starting (failed → submitting): `retry_started`
2. Retry succeeded (submitting → pending): `retry_succeeded`
3. Retry failed again (submitting → failed): `retry_failed`

### `src/domain/services/settlement.ts`

Add `auditLog` to deps. Record event for:

1. Bet settled (filled/pending → settled_won/settled_lost): `bet_settled` with metadata `{ outcome, profit, winningSide }`.

### `src/index.ts`

Wire the `auditLogRepo` into the services that need it. Follows existing dependency injection pattern — create the repo, pass it as a dep to betting, order-confirmation, bet-retry, and settlement services.

### `src/api/routes/bets.ts`

Add a GET endpoint for the audit log of a specific bet:

```typescript
app.get("/api/bets/:id/audit", async (c) => {
  const entries = await auditLog.findByBetId(c.req.param("id"));
  return c.json({ entries });
});
```

### `src/shared/api-types.ts`

Add the `BetAuditEntry` response type so the UI can consume it.

---

## Data & Migration

New table `bet_audit_log` — no existing data affected. Generate migration with `bunx drizzle-kit generate` and apply with `bun run src/infrastructure/database/migrate.ts`.

The audit log starts empty. Existing bets won't have historical audit entries, but all future status changes will be captured.

---

## Test Plan

1. **Audit log repo: record and findByBetId** — Insert audit entries, retrieve by betId, verify ordering by timestamp.

2. **Betting service: records bet_created and order_submitted on success** — Place a bet successfully, verify two audit entries with correct events, statuses, and orderId.

3. **Betting service: records bet_created and order_failed on failure** — Place a bet that fails, verify two audit entries with error and errorCategory.

4. **Betting service: audit failure does not block bet placement** — Mock `auditLog.record` to throw, verify bet is still placed successfully and warning is logged.

5. **Order confirmation: records order_confirmed** — Confirm a pending bet as filled, verify audit entry.

6. **Order confirmation: records order_cancelled** — Cancel a stale order, verify audit entry with age in metadata.

7. **Order confirmation: records stuck_bet_recovered** — Recover a stuck submitting bet, verify audit entry.

8. **Bet retry: records retry_started and retry_succeeded** — Retry a failed bet successfully, verify two audit entries.

9. **Bet retry: records retry_started and retry_failed** — Retry a failed bet that fails again, verify two audit entries with error details.

10. **Settlement: records bet_settled** — Settle a bet, verify audit entry with outcome and profit in metadata.

---

## Task Breakdown

- [ ] Add `betAuditLog` table to `src/infrastructure/database/schema.ts`
- [ ] Generate and apply migration with `bunx drizzle-kit generate`
- [ ] Create `src/infrastructure/database/repositories/audit-log.ts` with `record`, `findByBetId`, `findRecent`
- [ ] Add `BetAuditEntry` type to `src/shared/api-types.ts`
- [ ] Add `auditLog` dep to `createBettingService` in `src/domain/services/betting.ts` and record `bet_created` + `order_submitted`/`order_failed`
- [ ] Add `auditLog` dep to `createOrderConfirmationService` in `src/domain/services/order-confirmation.ts` and record `order_confirmed`, `order_cancelled`, `stuck_bet_recovered`, `ghost_order_detected`
- [ ] Add `auditLog` dep to `createBetRetryService` in `src/domain/services/bet-retry.ts` and record `retry_started`, `retry_succeeded`, `retry_failed`
- [ ] Add `auditLog` dep to `createSettlementService` in `src/domain/services/settlement.ts` and record `bet_settled`
- [ ] Wire `auditLogRepo` into all services in `src/index.ts`
- [ ] Add `GET /api/bets/:id/audit` route to `src/api/routes/bets.ts`
- [ ] Add repo tests in `tests/unit/infrastructure/database/repositories/audit-log.test.ts`
- [ ] Add betting service audit tests in `tests/unit/domain/services/betting.test.ts`
- [ ] Add order confirmation audit tests in `tests/unit/domain/services/order-confirmation.test.ts`
- [ ] Add bet retry audit tests in `tests/unit/domain/services/bet-retry.test.ts`
- [ ] Add settlement audit tests in `tests/unit/domain/services/settlement.test.ts`
- [ ] Run full test suite, type check, and lint
