# Plan: Per-Fixture Tight Loop — Eliminate Odds Drift in Prediction Pipeline

**Date:** 2026-03-03
**Status:** Complete

---

## Overview

The prediction pipeline currently interleaves stats fetching between odds refresh and bet placement. For each fixture, it refreshes odds for all markets, then fetches standings, H2H, injuries, team stats, and player stats (5+ API calls), and only then runs engines and places bets. By the time a bet is placed, the odds may have drifted from the values the engine used to make its prediction. This plan restructures the pipeline into two phases: a bulk stats-gathering phase, then a tight per-fixture odds→predict→bet cycle with no API calls in between.

---

## Current Flow (per fixture, sequential)

```
For each fixture:
  ┌─────────────────────────────────────────────────┐
  │ 1. Get markets from DB                          │
  │ 2. Refresh odds for ALL markets (Gamma API)     │  ← odds fetched here
  │ 3. Fetch standings (API-Football)               │
  │ 4. Fetch H2H (API-Football)                     │  ← 5+ API calls
  │ 5. Fetch injuries (API-Football)                │     between odds
  │ 6. Fetch team stats x2 (API-Football/cache)     │     and prediction
  │ 7. Fetch player stats x2 (API-Football/cache)   │
  │ 8. Build Statistics object                      │
  │ 9. Run all engines                              │  ← prediction here
  │ 10. For each prediction:                        │
  │     - Save prediction                           │
  │     - Validate stake                            │
  │     - Place bet                                 │  ← bet here (DRIFT!)
  └─────────────────────────────────────────────────┘
```

**Problem:** Steps 3–7 introduce seconds to minutes of delay between the odds used by the engine (step 2) and the bet placed (step 10). If multiple fixtures are processed, the drift compounds — fixture N's odds were fetched before fixture 1's stats were even gathered.

---

## Proposed Flow (two-phase)

```
PHASE 1: Pre-fetch stable data (all fixtures)
  ┌──────────────────────────────────────────────────┐
  │ 1. Read scheduled fixtures from DB               │
  │ 2. Get markets for each fixture from DB           │
  │ 3. For each fixture (parallelised where possible):│
  │    - Fetch standings                              │
  │    - Fetch H2H                                    │
  │    - Fetch injuries                               │
  │    - Fetch team stats (x2)                        │
  │    - Fetch player stats (x2)                      │
  │ 4. Store all gathered stats in a Map<fixtureId>   │
  └──────────────────────────────────────────────────┘

PHASE 2: Tight odds→predict→bet loop (per fixture)
  ┌──────────────────────────────────────────────────┐
  │ For each fixture:                                 │
  │   1. Refresh odds for all markets (Gamma API)     │ ← fresh odds
  │   2. Build Statistics from pre-fetched stats       │
  │   3. Run all engines                               │ ← immediate predict
  │   4. For each prediction:                          │
  │      - Save prediction                             │
  │      - Validate stake                              │
  │      - Place bet                                   │ ← immediate bet
  └──────────────────────────────────────────────────┘
```

**Result:** The only delay between odds fetch and bet placement is the engine execution time (sub-second for the weight-tuned engine) and the prediction save/validation (local DB + fast checks). No external API calls in between.

---

## Approach

Split the pipeline's `run()` method into two distinct phases:

1. **Phase 1 — `gatherFixtureStats()`**: Iterates all scheduled fixtures, fetches their markets from DB, and pre-fetches all stable sports data (standings, H2H, injuries, team/player stats). Returns a `Map<number, PreFetchedFixtureData>` keyed by fixture ID. Each entry holds the fixture, its market rows, and all gathered stats. Errors at this stage skip the fixture and log, same as today.

2. **Phase 2 — `processFixture()`**: For a single fixture, refreshes odds from Gamma, builds the `Statistics` object using pre-fetched stats + fresh odds, runs engines, saves predictions, validates stakes, and places bets — all in one tight sequence with no external calls between odds and bet.

### Why this approach

- **Minimal code change** — the logic stays in the same file, same function signatures. We're reordering operations, not redesigning the architecture.
- **No engine changes required** — engines still receive the same `Statistics` type with all markets. The weight-tuned engine's "pick the best market" logic is preserved.
- **Stats are inherently stable** — standings, H2H, injuries, and season stats don't change on a minute-by-minute basis. Pre-fetching them is safe.
- **Odds are the volatile data** — they should be fetched as close to bet placement as possible.

### Trade-offs

- **Memory usage slightly higher** — all fixture stats are held in memory during phase 1 before phase 2 starts. In practice this is negligible (a handful of fixtures, each with ~10KB of stats data).
- **If phase 1 takes a very long time, injury data could become stale** — but injuries don't change that frequently during a pipeline run (minutes, not hours), and they're already treated as optional/best-effort.
- **Stats errors discovered in phase 1 mean we skip fixtures earlier** — this is actually a benefit, as it avoids wasting an odds refresh on a fixture we can't process.

---

## Changes Required

### `src/orchestrator/prediction-pipeline.ts`

This is the only production file that changes.

#### 1. Add a `PreFetchedFixtureData` type

A container for everything gathered in phase 1:

```typescript
type PreFetchedFixtureData = {
  fixture: Fixture;
  fixtureLabel: string;
  marketRows: MarketRow[];
  homeStats: TeamStats;
  awayStats: TeamStats;
  h2h: H2H;
  injuries: Injury[];
  homeTeamSeasonStats?: TeamSeasonStats;
  awayTeamSeasonStats?: TeamSeasonStats;
  homeTeamPlayers?: PlayerSeasonStats[];
  awayTeamPlayers?: PlayerSeasonStats[];
};
```

#### 2. Extract `gatherFixtureStats()` helper

Moves lines 204–363 (the stats-gathering portion of the fixture loop) into a standalone async function that returns `PreFetchedFixtureData | null` (null = skip this fixture). This function does:

- Get markets from DB (`marketsRepo.findByFixtureId`)
- Fetch standings and find home/away
- Fetch H2H
- Fetch injuries
- Fetch team stats (x2, with cache)
- Fetch player stats (x2, with cache)

It does **not** refresh odds from Gamma — that happens in phase 2.

#### 3. Extract `processFixture()` helper

Takes a `PreFetchedFixtureData` and the pipeline deps/result accumulator. Does:

1. Refresh odds for each market in `data.marketRows` via `gammaClient.getMarketById()`
2. Build `marketMap` and `marketContexts` from fresh odds
3. Build `Statistics` from pre-fetched stats + fresh market contexts
4. `runAllEngines(engines, statistics)`
5. For each prediction: save, validate stake, place bet

#### 4. Restructure `run()` to call phase 1 then phase 2

```typescript
async run(): Promise<PredictionPipelineResult> {
  const result = { /* ... zero-initialised counters ... */ };

  const fixtureRows = await fixturesRepo.findScheduledUpcoming();
  if (fixtureRows.length === 0) return result;

  const engines = registry.getAll();
  if (engines.length === 0) return result;

  // Phase 1: Pre-fetch all stable data
  const preFetched = new Map<number, PreFetchedFixtureData>();
  for (const fixtureRow of fixtureRows) {
    const data = await gatherFixtureStats(fixtureRow);
    if (data) preFetched.set(data.fixture.id, data);
  }

  // Phase 2: Tight odds→predict→bet per fixture
  for (const data of preFetched.values()) {
    await processFixture(data, engines, result);
  }

  // ... existing logging ...
  return result;
}
```

#### 5. Move helper functions into module scope

`fetchTeamSeasonStats()` and `fetchPlayerStats()` are currently defined as closures inside the fixture loop. They'll be extracted as module-level functions (or methods on a context object) that take their dependencies explicitly so they can be called from `gatherFixtureStats()`.

Key signature change:

```typescript
async function fetchTeamSeasonStats(
  teamId: number,
  fixture: Fixture,
  footballClient: FootballClient,
  statsCache: ReturnType<typeof statsCacheRepoFactory>,
): Promise<TeamSeasonStats | undefined> { /* ... */ }

async function fetchPlayerStats(
  teamId: number,
  fixture: Fixture,
  injuries: Injury[],
  footballClient: FootballClient,
  statsCache: ReturnType<typeof statsCacheRepoFactory>,
): Promise<PlayerSeasonStats[] | undefined> { /* ... */ }
```

---

## Test Plan

All existing tests in `tests/unit/orchestrator/pipeline.test.ts` must continue to pass with the same assertions. The restructuring is internal — inputs and outputs don't change, only the order of operations.

**New test cases to add:**

1. **Stats pre-fetch failure skips fixture but processes others** — Two fixtures in DB, one has missing standings. Verify: first fixture is skipped, second is processed, result includes error for first.

2. **Odds are refreshed after stats are gathered, not before** — Mock `gammaClient.getMarketById` to track call order relative to `footballClient.getStandings`. Verify: all `getStandings` calls happen before any `getMarketById` calls.

3. **Multiple fixtures: each gets fresh odds independently** — Two fixtures with different markets. Verify: `getMarketById` is called for each fixture's markets separately, and the correct refreshed prices are used for each fixture's engine call.

---

## Task Breakdown

- [x] Add `PreFetchedFixtureData` type to `src/orchestrator/prediction-pipeline.ts`
- [x] Extract `fetchTeamSeasonStats()` from closure to module-level function with explicit deps
- [x] Extract `fetchPlayerStats()` from closure to module-level function with explicit deps
- [x] Extract `gatherFixtureStats()` function — takes a fixture row and deps, returns `PreFetchedFixtureData | null`
- [x] Extract `processFixture()` function — takes pre-fetched data and deps, does odds refresh → predict → bet
- [x] Restructure `run()` into two-phase loop: gather all stats, then process each fixture
- [x] Verify all existing tests pass without modification
- [x] Add test: stats pre-fetch failure skips fixture but processes others
- [x] Add test: odds refresh happens after all stats gathering (call order assertion)
- [x] Add test: multiple fixtures each get independently refreshed odds
