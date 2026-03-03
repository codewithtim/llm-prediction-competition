# Plan: UI Improvements — Polymarket Links, Failed Filter, Failed Reasons

**Date:** 2026-03-03
**Status:** Complete

---

## Overview

Three small, independent UI improvements: (1) add clickable Polymarket links to markets wherever they appear, (2) add a "Failed" tab to the bets filter bar, and (3) surface the failure reason (`errorMessage`, `errorCategory`) on failed bets. All three are data-plumbing + UI changes with no schema migration required — the underlying data already exists.

---

## Approach

All three changes follow the same pattern: pass existing DB fields through the API layer and render them in the UI. No new infrastructure, no new DB columns, no migrations.

**Polymarket links** — The `slug` field is already stored on every market in the DB. Polymarket market URLs follow the pattern `https://polymarket.com/event/{slug}`. We add `slug` to the `MarketSummary` DTO, pass it through both the `/markets` and `/fixtures/:id` API routes, and render the market question as an external link in the UI. For bets, we also pass `marketSlug` through so the bet row's market question links out.

**Failed filter** — Trivial: add `{ value: "failed", label: "Failed" }` to the `STATUS_TABS` array in the bets page. The server-side filtering already handles any status string.

**Failed reason** — The `errorMessage` and `errorCategory` columns exist on the `bets` table but are never included in the API response. Add them to `BetSummary`, pass them from the bets API route, and display them inline on failed bet rows in the UI.

### Trade-offs

- **URL pattern assumption** — We're constructing Polymarket URLs from the market `slug` as `https://polymarket.com/event/{slug}`. If Polymarket changes their URL scheme, these links break. Acceptable because the slug is their canonical identifier and the URL pattern has been stable.
- **No separate column for URL** — We construct the URL at render time rather than storing it. This avoids a migration and keeps the DB lean, but means the base URL (`https://polymarket.com/event/`) is hardcoded in the UI.
- **Error details visible to all users** — `errorMessage` may contain raw API error text. This is fine for an internal competition dashboard but would need sanitisation for a public-facing app.

---

## Changes Required

### `src/shared/api-types.ts`

Add `slug` to `MarketSummary` and add `errorMessage` + `errorCategory` to `BetSummary`:

```ts
// MarketSummary — add:
slug: string;

// BetSummary — add:
errorMessage: string | null;
errorCategory: string | null;
```

Also add `marketSlug` to `BetSummary` so bet rows can link to Polymarket:

```ts
marketSlug: string | null;
```

### `src/api/routes/markets.ts`

Pass `slug` through in the market mapping (line 28–42):

```ts
slug: m.slug,  // add to the market object spread
```

### `src/api/routes/fixtures.ts`

Pass `slug` through in the fixture detail's market mapping (line 68–81):

```ts
slug: m.slug,  // add to the market object spread
```

### `src/api/routes/bets.ts`

1. Build a `marketSlugMap` alongside the existing `marketMap` by using the full market objects already loaded at line 28:

```ts
const marketSlugMap = new Map(allMarkets.map((m) => [m.id, m.slug]));
```

2. Add three fields to the bet response object (lines 34–50):

```ts
marketSlug: marketSlugMap.get(b.marketId) ?? null,
errorMessage: b.errorMessage ?? null,
errorCategory: b.errorCategory ?? null,
```

### `ui/src/routes/bets/index.tsx`

1. Add `"failed"` to `STATUS_TABS` (between "Cancelled" and the end, or after "Cancelled"):

```ts
const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "filled", label: "Filled" },
  { value: "settled_won", label: "Won" },
  { value: "settled_lost", label: "Lost" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];
```

2. Make the market question cell a Polymarket link when `marketSlug` is present:

```tsx
<TableCell className="text-zinc-400 text-sm max-w-64 truncate">
  {b.marketSlug ? (
    <a
      href={`https://polymarket.com/event/${b.marketSlug}`}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-zinc-200 underline decoration-zinc-600 hover:decoration-zinc-400 transition-colors"
    >
      {b.marketQuestion}
    </a>
  ) : (
    b.marketQuestion
  )}
</TableCell>
```

3. Show error reason on failed bets. Add a row below the status badge when `b.status === "failed"` and `b.errorMessage` exists. Use a tooltip or inline text under the status cell:

```tsx
<TableCell>
  <div className="flex flex-col gap-1">
    <StatusBadge status={b.status} />
    {b.status === "failed" && b.errorMessage && (
      <span className="text-xs text-red-400/70 max-w-48 truncate" title={b.errorMessage}>
        {b.errorCategory ? `${b.errorCategory}: ` : ""}{b.errorMessage}
      </span>
    )}
  </div>
</TableCell>
```

### `ui/src/routes/markets/index.tsx`

Make the question cell a Polymarket link:

```tsx
<TableCell className="text-zinc-200 max-w-72 truncate">
  {m.slug ? (
    <a
      href={`https://polymarket.com/event/${m.slug}`}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-zinc-100 underline decoration-zinc-600 hover:decoration-zinc-400 transition-colors"
    >
      {m.question}
    </a>
  ) : (
    m.question
  )}
</TableCell>
```

### `ui/src/routes/fixtures/$id.tsx`

Same treatment for market questions in the fixture detail markets table:

```tsx
<TableCell className="text-zinc-200">
  {m.slug ? (
    <a
      href={`https://polymarket.com/event/${m.slug}`}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-zinc-100 underline decoration-zinc-600 hover:decoration-zinc-400 transition-colors"
    >
      {m.question}
    </a>
  ) : (
    m.question
  )}
</TableCell>
```

---

## Data & Migration

No migration required. All data already exists in the database:
- `markets.slug` — populated on every market since initial discovery
- `bets.error_message` and `bets.error_category` — populated on every failed bet since the bet-state-machine feature

---

## Test Plan

### API route tests

1. **Markets route includes slug** — verify the `/markets` response objects include the `slug` field.
2. **Fixture detail includes slug on markets** — verify `/fixtures/:id` response's `markets` array includes `slug`.
3. **Bets route includes error fields** — verify `/bets` response includes `errorMessage`, `errorCategory`, and `marketSlug` for a failed bet. Verify they are `null` for a non-failed bet.

### UI (manual verification)

4. **Markets page** — market questions render as clickable links opening Polymarket in a new tab.
5. **Fixture detail page** — same for markets listed under a fixture.
6. **Bets page — Failed tab** — clicking "Failed" tab filters to only failed bets.
7. **Bets page — error reason** — failed bets show error category and message under the status badge.
8. **Bets page — market link** — market question column links to Polymarket.

---

## Task Breakdown

- [x] Add `slug` field to `MarketSummary` type in `src/shared/api-types.ts`
- [x] Add `marketSlug`, `errorMessage`, `errorCategory` fields to `BetSummary` type in `src/shared/api-types.ts`
- [x] Pass `slug` through in `src/api/routes/markets.ts` market response mapping
- [x] Pass `slug` through in `src/api/routes/fixtures.ts` fixture detail market mapping
- [x] Add `marketSlugMap` and pass `marketSlug`, `errorMessage`, `errorCategory` in `src/api/routes/bets.ts`
- [x] Add `{ value: "failed", label: "Failed" }` to `STATUS_TABS` in `ui/src/routes/bets/index.tsx`
- [x] Render market question as Polymarket link in `ui/src/routes/bets/index.tsx`
- [x] Render error reason under status badge for failed bets in `ui/src/routes/bets/index.tsx`
- [x] Render market question as Polymarket link in `ui/src/routes/markets/index.tsx`
- [x] Render market question as Polymarket link in `ui/src/routes/fixtures/$id.tsx`
- [x] Update existing API route tests (markets, fixtures, bets) to assert new fields
- [x] Manual smoke test: verify links open correct Polymarket pages, failed filter works, error reasons display
