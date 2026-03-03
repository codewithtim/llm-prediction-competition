# Plan: Bet Error Category Enum & Attempts in UI

**Date:** 2026-03-03
**Status:** Complete

---

## Overview

Make `errorCategory` a proper Drizzle text enum in the DB schema (matching the existing `BetErrorCategory` type), keep `errorMessage` as-is for raw error reference, and surface the attempt count in the bets API and UI.

---

## Approach

**Enum in schema** — Change `errorCategory: text("error_category")` to `text("error_category", { enum: [...] })` using the same values as the `BetErrorCategory` type. This is a Drizzle-level type constraint only — SQLite stores text regardless, so no migration is needed. The benefit is Drizzle-level type safety on inserts/updates.

**Attempts in API + UI** — Add `attempts` to `BetSummary` and the bets API response. Show it in the UI on failed bet rows alongside the error category.

**Error category display** — Currently shown as a raw string prefix (`insufficient_funds: ...`). Improve by displaying it as a human-readable label (e.g. "Insufficient Funds") separate from the raw error message. The raw message stays as a tooltip.

### Trade-offs

- **No migration** — The enum constraint is Drizzle-only. If data is inserted outside Drizzle, SQLite won't enforce it. Acceptable since all writes go through Drizzle.
- **Human-readable labels are UI-only** — The API still returns the snake_case enum value. The UI maps it to a label. This keeps the API stable.

---

## Changes Required

### `src/infrastructure/database/schema.ts`

Change the `errorCategory` column definition to use enum:

```ts
errorCategory: text("error_category", {
  enum: ["insufficient_funds", "network_error", "rate_limited", "wallet_error", "invalid_market", "unknown"],
}),
```

### `src/shared/api-types.ts`

Add `attempts` to `BetSummary`:

```ts
attempts: number;
```

### `src/api/routes/bets.ts`

Pass `attempts` in the bet response mapping:

```ts
attempts: b.attempts ?? 0,
```

### `ui/src/routes/bets/index.tsx`

Update the failed bet error display. Replace the current inline `{b.errorCategory}: {b.errorMessage}` with:

1. A human-readable label for the error category
2. The attempt count (e.g. "attempt 3")
3. Raw error message as the tooltip on hover

```tsx
const ERROR_LABELS: Record<string, string> = {
  insufficient_funds: "Insufficient Funds",
  network_error: "Network Error",
  rate_limited: "Rate Limited",
  wallet_error: "Wallet Error",
  invalid_market: "Invalid Market",
  unknown: "Unknown Error",
};
```

Display under the status badge for failed bets:

```tsx
{b.status === "failed" && (
  <span
    className="text-xs text-red-400/70 max-w-48 truncate"
    title={b.errorMessage ?? undefined}
  >
    {ERROR_LABELS[b.errorCategory ?? ""] ?? b.errorCategory ?? "Error"}
    {b.attempts > 1 ? ` (attempt ${b.attempts})` : ""}
  </span>
)}
```

---

## Data & Migration

No migration required. The Drizzle `text` enum is a TypeScript-level constraint — the underlying SQLite column stays `text`. Existing data is unaffected.

---

## Test Plan

1. **Bets API returns attempts** — verify `/bets` response includes `attempts` field with correct value.
2. **Bets API returns attempts=0 for non-failed bet** — verify default.
3. **Schema enum matches BetErrorCategory type** — existing tests that insert bets with error categories continue to pass.

---

## Task Breakdown

- [x] Add enum values to `errorCategory` column in `src/infrastructure/database/schema.ts`
- [x] Add `attempts` field to `BetSummary` in `src/shared/api-types.ts`
- [x] Pass `attempts` through in `src/api/routes/bets.ts`
- [x] Add `ERROR_LABELS` map and update failed bet display in `ui/src/routes/bets/index.tsx`
- [x] Update bets API test to assert `attempts` field in `tests/unit/api/bets.test.ts`
- [x] Run type check, tests, and lint
