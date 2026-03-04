# Plan: Eliminate N+1 Database Queries and Add Batch-Query Convention

**Date:** 2026-03-04
**Status:** Complete

---

## Overview

The codebase has multiple N+1 query patterns where loops fetch individual rows one at a time. The worst offender is `buildLeaderboard()` in the iteration service, which is called once per competitor inside `iterateAll()`, making it O(N²). The same anti-pattern appears in the dashboard and competitors API routes, and in `buildRecentOutcomes()` (one `markets.findById` per prediction). This plan fixes all instances and adds a convention rule to prevent recurrence.

---

## Approach

**Strategy: batch-fetch-then-map** — replace every loop-with-individual-query with a single bulk query followed by in-memory lookup. This is the standard fix for N+1 problems and matches the pattern already used in dashboard.ts lines 68-74 (the `lookups` maps).

For `betsRepo.getPerformanceStats`: rather than adding a new SQL aggregation query, we add a `getAllPerformanceStats()` method that fetches all bets once and computes stats in JS (same logic as today, just batched). This keeps the stats computation in one place and avoids duplicating aggregation logic in SQL.

For `marketsRepo`: add a `findByIds(ids: string[])` method using `inArray`.

For the O(N²) `buildLeaderboard` call in `iterateAll`: compute the leaderboard once and pass it into `iterateCompetitor` as an optional argument.

### Trade-offs

- **More memory**: `getAllPerformanceStats` loads all bets into memory at once. With the current scale (hundreds of bets, not millions), this is fine. If bet volume grows significantly, we'd want SQL-level aggregation — but that's premature now.
- **Slightly more complex signatures**: `iterateCompetitor` gains an optional `leaderboard` parameter. This is a minor API surface increase but eliminates O(N²) behaviour.

---

## Changes Required

### `src/infrastructure/database/repositories/bets.ts`

Add `getAllPerformanceStats()` that fetches all bets in one query and returns a `Map<competitorId, PerformanceStats>`.

```typescript
async getAllPerformanceStats() {
  const rows = await db.select().from(bets).all();

  const byCompetitor = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) {
    const existing = byCompetitor.get(row.competitorId) ?? [];
    existing.push(row);
    byCompetitor.set(row.competitorId, existing);
  }

  const result = new Map<string, PerformanceStats>();
  for (const [competitorId, competitorRows] of byCompetitor) {
    result.set(competitorId, computeStats(competitorId, competitorRows));
  }
  return result;
}
```

Extract the existing stats computation from `getPerformanceStats` into a shared `computeStats(competitorId, rows)` helper (file-local, not exported) so both methods use the same logic.

The `PerformanceStats` return type is already defined inline in the existing method. We'll extract it to a named type at the top of the file for reuse.

### `src/infrastructure/database/repositories/markets.ts`

Add `findByIds(ids: string[])` using `inArray`:

```typescript
async findByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(markets).where(inArray(markets.id, ids)).all();
}
```

Import `inArray` from `drizzle-orm` (already available — used in bets.ts).

### `src/competitors/weight-tuned/iteration.ts`

Three changes:

**1. Replace `buildLeaderboard()` N+1 with batch approach:**

```typescript
async function buildLeaderboard(): Promise<LeaderboardEntry[]> {
  const active = await competitors.findByStatus("active");
  const statsMap = await bets.getAllPerformanceStats();

  return active
    .map((c) => {
      const stats = statsMap.get(c.id);
      return {
        name: c.name,
        accuracy: stats?.accuracy ?? 0,
        roi: stats?.roi ?? 0,
        profitLoss: stats?.profitLoss ?? 0,
      };
    })
    .sort((a, b) => b.profitLoss - a.profitLoss);
}
```

**2. Replace `buildRecentOutcomes()` N+1 with batch market fetch:**

```typescript
async function buildRecentOutcomes(competitorId: string): Promise<PredictionOutcome[]> {
  const allPredictions = await predictions.findByCompetitor(competitorId);
  const allBets = await bets.findByCompetitor(competitorId);

  const betsByMarket = new Map<string, (typeof allBets)[number]>();
  for (const bet of allBets) {
    betsByMarket.set(bet.marketId, bet);
  }

  // Batch-fetch all markets at once
  const marketIds = [...new Set(allPredictions.map((p) => p.marketId))];
  const marketList = await markets.findByIds(marketIds);
  const marketMap = new Map(marketList.map((m) => [m.id, m]));

  const outcomes: PredictionOutcome[] = [];
  for (const pred of allPredictions) {
    const market = marketMap.get(pred.marketId);
    const bet = betsByMarket.get(pred.marketId);

    let result: "won" | "lost" | "pending" = "pending";
    let profit: number | null = null;

    if (bet) {
      if (bet.status === "settled_won") { result = "won"; profit = bet.profit; }
      else if (bet.status === "settled_lost") { result = "lost"; profit = bet.profit; }
    }

    outcomes.push({
      marketQuestion: market?.question ?? pred.marketId,
      side: pred.side,
      confidence: pred.confidence,
      stake: pred.stake,
      result,
      profit,
      extractedFeatures: pred.extractedFeatures ?? undefined,
    });
  }

  return outcomes;
}
```

**3. Eliminate O(N²) in `iterateAll` by computing leaderboard once:**

Add an optional `precomputedLeaderboard` parameter to `iterateCompetitor`:

```typescript
async function iterateCompetitor(
  competitorId: string,
  precomputedLeaderboard?: LeaderboardEntry[],
): Promise<WeightIterationResult> {
  // ... existing code ...
  const leaderboard = precomputedLeaderboard ?? await buildLeaderboard();
  // ...
}
```

Update `iterateAll` to build leaderboard once:

```typescript
async function iterateAll(): Promise<WeightIterationResult[]> {
  const groups = await Promise.all(
    [...ITERABLE_STATUSES].map((s) => competitors.findByStatus(s)),
  );
  const weightTuned = groups.flat().filter((c) => c.type === "weight-tuned");

  const leaderboard = await buildLeaderboard();

  const results: WeightIterationResult[] = [];
  for (const competitor of weightTuned) {
    const result = await iterateCompetitor(competitor.id, leaderboard);
    results.push(result);
  }
  return results;
}
```

### `src/api/routes/dashboard.ts`

Replace the per-competitor `getPerformanceStats` loop (lines 29-59) with a single bulk call:

```typescript
const statsMap = await deps.betsRepo.getAllPerformanceStats();

const leaderboard = allCompetitors.map((comp) => {
  const stats = statsMap.get(comp.id) ?? EMPTY_STATS;
  return {
    competitor: {
      id: comp.id,
      name: comp.name,
      /* ... same shape, using stats from map ... */
    },
    rank: 0,
  };
});
```

Where `EMPTY_STATS` is a zero-valued stats object defined locally. This removes the `await Promise.all(allCompetitors.map(async ...))` entirely.

### `src/api/routes/competitors.ts`

**List endpoint (lines 20-47):** Same fix — replace `Promise.all(allCompetitors.map(async ...))` with `getAllPerformanceStats()` + map lookup.

**Detail endpoint (lines 67-73):** Replace the `for (const mid of marketIds)` loop with `findByIds(marketIds)`:

```typescript
const marketList = await deps.marketsRepo.findByIds(marketIds);
const marketById = new Map(marketList.map((m) => [m.id, m]));
```

### `.claude/skill-context/planning.md`

Add a new convention rule under "Conventions to Follow":

```markdown
- **No N+1 queries** — never call a repository method inside a loop. Fetch data in bulk (using `inArray`, `findAll`, or a dedicated batch method), build a Map, then look up in memory. If a batch method doesn't exist, add one to the repo before using it in a loop.
```

---

## Test Plan

### `tests/unit/infrastructure/database/repositories/bets.test.ts`

- **`getAllPerformanceStats` returns empty map when no bets exist** — assert `result.size === 0`.
- **`getAllPerformanceStats` groups stats by competitor** — insert bets for 2 competitors, assert map has 2 entries with correct stats for each.
- **`getAllPerformanceStats` matches single-competitor stats** — for each competitor, verify `getAllPerformanceStats().get(id)` equals `getPerformanceStats(id)`.

### `tests/unit/infrastructure/database/repositories/markets.test.ts`

- **`findByIds` returns matching markets** — insert 3 markets, query 2 by ID, assert 2 returned.
- **`findByIds` returns empty array for empty input** — assert `[]` returned.
- **`findByIds` ignores non-existent IDs** — query with a mix of real and fake IDs, assert only real ones returned.

### `tests/unit/competitors/weight-tuned/iteration.test.ts`

- **Existing tests still pass** — no behavioural changes, just internal optimisation. Mock method names change (`getAllPerformanceStats` added to mock, `getPerformanceStats` still present for single-competitor use inside `iterateCompetitor`).
- **`iterateAll` calls `buildLeaderboard` once, not N times** — verify `findByStatus` in competitorsRepo (used inside `buildLeaderboard`) is called the expected number of times (once for the leaderboard build, once per status for the iteration query).

### `tests/unit/api/dashboard.test.ts` and `tests/unit/api/competitors.test.ts`

- **Update mocks** to include `getAllPerformanceStats` returning a Map.
- **Existing assertions still pass** — same response shape, different internal fetching.

---

## Task Breakdown

- [x] Extract `computeStats` helper in `src/infrastructure/database/repositories/bets.ts` — pull computation logic out of `getPerformanceStats` into a file-local function; make `getPerformanceStats` call it
- [x] Add `getAllPerformanceStats()` method to `src/infrastructure/database/repositories/bets.ts` — fetch all bets, group by competitorId, call `computeStats` per group, return Map
- [x] Add `findByIds(ids: string[])` method to `src/infrastructure/database/repositories/markets.ts` — import `inArray`, return matching rows
- [x] Update `buildLeaderboard()` in `src/competitors/weight-tuned/iteration.ts` — use `bets.getAllPerformanceStats()` instead of per-competitor loop
- [x] Update `buildRecentOutcomes()` in `src/competitors/weight-tuned/iteration.ts` — use `markets.findByIds()` instead of per-prediction `findById`
- [x] Add optional `precomputedLeaderboard` parameter to `iterateCompetitor()` in `src/competitors/weight-tuned/iteration.ts`
- [x] Update `iterateAll()` in `src/competitors/weight-tuned/iteration.ts` — build leaderboard once and pass to each `iterateCompetitor` call
- [x] Update dashboard route `src/api/routes/dashboard.ts` — replace `Promise.all` + per-competitor stats with `getAllPerformanceStats()` map lookup
- [x] Update competitors list route `src/api/routes/competitors.ts` — replace `Promise.all` + per-competitor stats with `getAllPerformanceStats()` map lookup
- [x] Update competitor detail route `src/api/routes/competitors.ts` — replace `for` loop of `findById` with `findByIds`
- [x] Write tests for `getAllPerformanceStats` in `tests/unit/infrastructure/database/repositories/bets.test.ts`
- [x] Write tests for `findByIds` in `tests/unit/infrastructure/database/repositories/markets.test.ts` (add file if needed)
- [x] Update mocks in `tests/unit/competitors/weight-tuned/iteration.test.ts` — add `getAllPerformanceStats` to betsRepo mock
- [x] Update mocks in `tests/unit/api/dashboard.test.ts` and `tests/unit/api/competitors.test.ts` — add `getAllPerformanceStats` and `findByIds` to mocks
- [x] Run full test suite (`bun test`) and fix any failures
- [x] Add "No N+1 queries" convention to `.claude/skill-context/planning.md`
