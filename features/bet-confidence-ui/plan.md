# Plan: Add Prediction Confidence to Bet UI Rows

**Date:** 2026-03-03
**Status:** Complete

---

## Overview

Bet UI rows currently show amount, price, side, status, and profit — but not the AI's confidence level from the underlying prediction. This change adds `confidence` (from the `predictions` table) to every `BetSummary` response and displays it in all three bet-display locations: the Bets page, the Competitor Detail bets tab, and the Dashboard recent activity card.

---

## Approach

Bets and predictions are separate tables with no direct FK. They are linked by the composite key `(competitorId, marketId, side)` — each bet originates from a prediction for the same competitor + market + side.

**Strategy:** In each API route that returns `BetSummary`, also fetch all predictions and build a lookup map keyed by `competitorId:marketId:side`. When mapping a bet to its response shape, look up the confidence from the map. If no matching prediction exists, return `null`.

This avoids schema changes, migrations, or denormalization. The join is done in the API layer at map time.

### Trade-offs

- **Extra query per endpoint:** Each bet-serving route now also fetches predictions. For the bets route and dashboard route this means one additional `findAll()` call. For the competitor detail route, predictions are already fetched — no extra query needed.
- **Composite key assumption:** Assumes `(competitorId, marketId, side)` uniquely identifies a bet's source prediction. If a competitor has multiple predictions for the same market+side (e.g. from re-runs), this takes the latest one. This matches the current system where one prediction → one bet.
- **Alternative considered — denormalize:** Adding a `predictionId` FK or `confidence` column to `bets` would be cleaner long-term but requires a migration, backfill logic, and changes to the betting service. Not worth it for a display-only concern.

---

## Changes Required

### `src/shared/api-types.ts`

Add `confidence: number | null` to `BetSummary`:

```typescript
export type BetSummary = {
  // ... existing fields ...
  profit: number | null;
  confidence: number | null;  // ← new
};
```

### `src/api/routes/bets.ts`

Fetch predictions and build a lookup map. Attach confidence to each mapped bet.

```typescript
// After existing fetches, add:
const allPredictions = await deps.predictionsRepo.findAll();
const predictionMap = new Map(
  allPredictions.map((p) => [`${p.competitorId}:${p.marketId}:${p.side}`, p.confidence]),
);

// In the map callback, add:
confidence: predictionMap.get(`${b.competitorId}:${b.marketId}:${b.side}`) ?? null,
```

### `src/api/routes/dashboard.ts`

Same pattern — fetch predictions, build map, enrich `recentBets`:

```typescript
// Add to the Promise.all:
const [allCompetitors, allFixtures, allMarkets, allBets, recentBetsRaw, allPredictions] =
  await Promise.all([
    // ... existing ...
    deps.predictionsRepo.findAll(),
  ]);

const predictionMap = new Map(
  allPredictions.map((p) => [`${p.competitorId}:${p.marketId}:${p.side}`, p.confidence]),
);

// In recentBets mapping, add:
confidence: predictionMap.get(`${b.competitorId}:${b.marketId}:${b.side}`) ?? null,
```

### `src/api/routes/competitors.ts`

Predictions are already fetched in the detail endpoint. Build the map from the existing `predictions` variable:

```typescript
// After existing predictions fetch, add:
const predictionMap = new Map(
  predictions.map((p) => [`${p.competitorId}:${p.marketId}:${p.side}`, p.confidence]),
);

// In recentBets mapping, add:
confidence: predictionMap.get(`${b.competitorId}:${b.marketId}:${b.side}`) ?? null,
```

### `ui/src/routes/bets/index.tsx`

Add a "Confidence" column between "Side" and "Amount":

```tsx
// Header
<TableHead className="text-zinc-400 text-right">Confidence</TableHead>

// Cell
<TableCell className="text-right font-mono text-zinc-300">
  {b.confidence != null ? formatPct(b.confidence) : "—"}
</TableCell>
```

Import `formatPct` from `@/lib/format`.

### `ui/src/routes/competitors/$id.tsx`

Add a "Confidence" column to the bets tab between "Side" and "Amount":

```tsx
// Header
<TableHead className="text-zinc-400 text-right">Confidence</TableHead>

// Cell
<TableCell className="text-right font-mono text-zinc-300">
  {b.confidence != null ? formatPct(b.confidence) : "—"}
</TableCell>
```

### `ui/src/components/dashboard/recent-activity.tsx`

Add confidence inline with the existing side/price/time row:

```tsx
<div className="flex items-center gap-2 text-xs text-zinc-500">
  <span className="font-mono">{bet.side}</span>
  {bet.confidence != null && (
    <span className="font-mono">{formatPct(bet.confidence)}</span>
  )}
  <span>@ ${bet.price.toFixed(2)}</span>
  <span>{formatDateTime(bet.placedAt)}</span>
</div>
```

Import `formatPct` from `@/lib/format`.

---

## Data & Migration

No migration needed. Confidence is read from the existing `predictions` table and joined at the API layer.

---

## Test Plan

### `tests/unit/api/bets.test.ts`

- **"returns confidence from matching prediction"**: Mock `predictionsRepo.findAll` with a prediction matching the bet's `competitorId:marketId:side`. Assert `data[0].confidence` equals the prediction's confidence value.
- **"returns null confidence when no prediction matches"**: Mock `predictionsRepo.findAll` returning empty. Assert `data[0].confidence` is `null`.

### `tests/unit/api/dashboard.test.ts`

- Verify `recentBets[].confidence` is present in dashboard response (update existing test if one exists for recentBets shape).

### `tests/unit/api/competitors.test.ts`

- Verify `recentBets[].confidence` is present in competitor detail response.

---

## Task Breakdown

- [x] Add `confidence: number | null` to `BetSummary` in `src/shared/api-types.ts`
- [x] Update `src/api/routes/bets.ts`: fetch predictions, build lookup map, attach `confidence` to each bet
- [x] Update `src/api/routes/dashboard.ts`: add predictions to `Promise.all`, build lookup map, attach `confidence` to `recentBets`
- [x] Update `src/api/routes/competitors.ts`: build prediction lookup map from existing `predictions` fetch, attach `confidence` to `recentBets`
- [x] Update `ui/src/routes/bets/index.tsx`: add Confidence column header and cell, import `formatPct`
- [x] Update `ui/src/routes/competitors/$id.tsx`: add Confidence column to bets tab
- [x] Update `ui/src/components/dashboard/recent-activity.tsx`: display confidence inline, import `formatPct`
- [x] Update `tests/unit/api/bets.test.ts`: add test for confidence present and null cases
- [x] Update `tests/unit/api/dashboard.test.ts`: verify confidence in recentBets shape
- [x] Update `tests/unit/api/competitors.test.ts`: verify confidence in recentBets shape
- [x] Run `bun run lint` and `bun run test` to verify
