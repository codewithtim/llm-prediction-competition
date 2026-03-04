# Plan: Bet Detail Page

**Date:** 2026-03-04
**Status:** Complete

---

## Overview

Add an individual bet detail page at `/bets/$id` that shows full bet information — market, competitor, fixture, prediction reasoning, error details, and timeline. Make bet rows clickable throughout the app: from the bets list page, the dashboard recent activity, and the competitor detail bets tab.

---

## Approach

Follow the existing detail page pattern (`/competitors/$id`, `/fixtures/$id`): add a `GET /api/bets/:id` endpoint returning an enriched `BetDetailResponse`, a `useBet(id)` hook, and a `BetDetailPage` component. Add `<Link>` wrappers on bet rows in all three locations where bets are displayed.

The bet detail page shows everything we know about a bet in a single view:
- Header with market question and status
- Key financial stats (amount, price, shares, confidence, P&L)
- Linked entities (competitor, fixture, market on Polymarket)
- The prediction reasoning that led to this bet (via the existing `ReasoningCell` modal pattern, but displayed inline since this is a detail page)
- Error information for failed bets
- Timeline (placed, settled, attempts)

### Trade-offs

- **Single API call** — the `/bets/:id` endpoint fetches the bet, its related prediction, competitor, market, and fixture in one call. This means 4-5 small DB lookups per request. Given SQLite/Turso and the read-only nature, this is fine. Alternative: use the existing `/bets` list endpoint and filter client-side — rejected because it loads all bets unnecessarily.
- **Prediction lookup by composite key** — predictions are matched to bets via `competitorId:marketId:side` (same as the list endpoint). There's no direct `predictionId` FK on the bets table. This is consistent with the existing approach. If a prediction doesn't exist (e.g., manual or retried bet), we gracefully show "No prediction data".
- **Inline reasoning display** — on the detail page we show the full reasoning sections inline rather than in a modal, since this is the dedicated detail view and there's no space constraint.

---

## Changes Required

### `src/shared/api-types.ts`

Add `BetDetailResponse` type that extends `BetSummary` with related entity details:

```typescript
export type BetDetailResponse = BetSummary & {
  fixtureSummary: string | null;    // "Team A vs Team B"
  fixtureDate: string | null;
  fixtureStatus: string | null;
  marketOutcomes: [string, string] | null;
  marketOutcomePrices: [string, string] | null;
  marketActive: boolean | null;
  marketClosed: boolean | null;
  reasoning: ReasoningDTO | null;   // Full prediction reasoning
  orderId: string | null;
  shares: number;                   // Already on BetSummary
  settledAt: string | null;         // Already on BetSummary
  lastAttemptAt: string | null;
};
```

### `src/api/routes/bets.ts`

Add `GET /bets/:id` endpoint:

```typescript
app.get("/bets/:id", async (c) => {
  const id = c.req.param("id");
  const bet = await deps.betsRepo.findById(id);
  if (!bet) return c.json({ error: "Bet not found" }, 404);

  const [competitor, market, fixture, predictions] = await Promise.all([
    deps.competitorsRepo.findById(bet.competitorId),
    deps.marketsRepo.findById(bet.marketId),
    deps.fixturesRepo.findById(bet.fixtureId),
    deps.predictionsRepo.findByMarket(bet.marketId),
  ]);

  const prediction = predictions.find(
    (p) => p.competitorId === bet.competitorId && p.side === bet.side
  );

  return c.json({ /* mapped BetDetailResponse */ });
});
```

Need to verify that `competitorsRepo`, `marketsRepo`, and `fixturesRepo` all have `findById` methods. The bets and predictions repos already do.

### `src/infrastructure/database/repositories/competitors.ts`

Check if `findById` exists. If not, add it (same pattern as other repos).

### `src/infrastructure/database/repositories/markets.ts`

Check if `findById` exists. If not, add it.

### `ui/src/lib/api.ts`

Add `useBet` hook:

```typescript
export function useBet(id: string) {
  return useQuery<BetDetailResponse>({
    queryKey: ["bet", id],
    queryFn: () => fetchJson(`/bets/${id}`),
  });
}
```

### `ui/src/routes/bets/$id.tsx` (new file)

Bet detail page component. Layout:

```
PageShell (title = market question, subtitle = competitor name + placed date)
  ├── StatusBadge + ExternalLink to Polymarket
  │
  ├── Stat cards grid (4 cols):
  │   ├── Amount ($X.XX)
  │   ├── Price (0.XX)
  │   ├── Confidence (XX.X%)
  │   └── P&L (+$X.XX / pending)
  │
  ├── Details section (key-value pairs):
  │   ├── Competitor (linked to /competitors/$id)
  │   ├── Fixture (linked to /fixtures/$id)
  │   ├── Side (YES/NO)
  │   ├── Shares
  │   ├── Order ID (if present)
  │   ├── Placed at
  │   ├── Settled at (if settled)
  │   ├── Attempts (if > 0)
  │
  ├── Error section (if status === "failed"):
  │   ├── Error category badge
  │   └── Error message
  │
  └── Reasoning section (if prediction exists):
      └── Reasoning summary + sections rendered inline
```

Uses existing shared components: `PageShell`, `StatusBadge`, `StatCard`, `Money`, `ExternalLink`, `LoadingSkeleton`, `EmptyState`.

### `ui/src/router.tsx`

Add bet detail route:

```typescript
import { BetDetailPage } from "@/routes/bets/$id";

const betDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/bets/$id",
  component: BetDetailPage,
});

// Add to routeTree children
```

### `ui/src/routes/bets/index.tsx`

Make the market question cell a `<Link>` to `/bets/$id`:

```typescript
import { Link } from "@tanstack/react-router";

// In the table row, replace the ExternalLink on market question:
<Link
  to="/bets/$id"
  params={{ id: b.id }}
  className="text-zinc-100 hover:text-emerald-400 transition-colors"
>
  {b.marketQuestion}
</Link>
```

Keep the Polymarket external link available on the detail page instead.

### `ui/src/components/dashboard/recent-activity.tsx`

Wrap each bet item in a `<Link>` to `/bets/$id`:

```typescript
import { Link } from "@tanstack/react-router";

// Wrap the bet div in a Link
<Link
  key={bet.id}
  to="/bets/$id"
  params={{ id: bet.id }}
  className="block"
>
  <div className="flex items-center justify-between border-b border-zinc-800 pb-3 last:border-0 hover:bg-zinc-800/50 -mx-2 px-2 rounded transition-colors">
    {/* existing content */}
  </div>
</Link>
```

### `ui/src/routes/competitors/$id.tsx`

Make bet rows in the competitor detail bets tab clickable via `<Link>`:

```typescript
import { Link } from "@tanstack/react-router";

// In the bets table, wrap the market question:
<Link
  to="/bets/$id"
  params={{ id: b.id }}
  className="text-zinc-100 hover:text-emerald-400 transition-colors"
>
  {b.marketQuestion}
</Link>
```

---

## Data & Migration

No schema changes. No migrations needed. The `BetDetailResponse` is an API-only type built from existing tables.

---

## Test Plan

1. **API: `GET /bets/:id` returns enriched bet** — mock repos, verify response includes competitor name, market question, fixture summary, prediction reasoning.
2. **API: `GET /bets/:id` returns 404 for unknown ID** — verify 404 JSON response.
3. **API: `GET /bets/:id` handles missing prediction gracefully** — verify `reasoning` is null when no matching prediction exists.
4. **API: `GET /bets/:id` handles missing fixture/market gracefully** — verify null fields when related entity is missing.

---

## Task Breakdown

- [x] Add `findById` to competitors repo if missing (`src/infrastructure/database/repositories/competitors.ts`) — already exists
- [x] Add `findById` to markets repo if missing (`src/infrastructure/database/repositories/markets.ts`) — already exists
- [x] Add `BetDetailResponse` type to `src/shared/api-types.ts`
- [x] Add `GET /bets/:id` endpoint in `src/api/routes/bets.ts`
- [x] Add `useBet` hook in `ui/src/lib/api.ts`
- [x] Create `ui/src/routes/bets/$id.tsx` — bet detail page component
- [x] Register `/bets/$id` route in `ui/src/router.tsx`
- [x] Add `<Link>` to bet detail from bets list page (`ui/src/routes/bets/index.tsx`)
- [x] Add `<Link>` to bet detail from dashboard recent activity (`ui/src/components/dashboard/recent-activity.tsx`)
- [x] Add `<Link>` to bet detail from competitor detail bets tab (`ui/src/routes/competitors/$id.tsx`)
- [x] Add API tests for `GET /bets/:id` (happy path, 404, missing prediction)
