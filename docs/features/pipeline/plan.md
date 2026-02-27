# Feature 10: Pipeline Orchestration — Plan

## Goal

Wire all existing services (Features 3–9) into an automated pipeline with a cron-style scheduler. Two independent loops run on configurable intervals:

1. **Prediction pipeline**: discover → match → stats → predict → bet
2. **Settlement loop**: check resolved markets → settle bets → log results

## Architecture

### Trigger: Built-in `setInterval` scheduler

The Bun server process manages scheduling internally. No external cron, no HTTP endpoints. On startup, the scheduler registers two intervals:

- **Prediction** — default every 6 hours (configurable)
- **Settlement** — default every 2 hours (configurable)

Each interval calls the same pipeline function. A mutex flag prevents overlapping runs.

---

## Files to Create

### 1. `src/orchestrator/config.ts`

Pipeline configuration type and defaults.

```typescript
export type PipelineConfig = {
  leagues: Array<{ id: number; name: string; country: string }>;
  season: number;
  fixtureLookAheadDays: number;
  predictionIntervalMs: number;
  settlementIntervalMs: number;
  betting: BettingConfig;
};
```

**Exports:**
- `PipelineConfig` type
- `DEFAULT_LEAGUES` — EPL (39), La Liga (140), Serie A (135), Bundesliga (78), Ligue 1 (61)
- `DEFAULT_CONFIG` — sensible defaults (season 2024, 7-day lookahead, 6h prediction interval, 2h settlement, dryRun: true, $10 max stake, $100 max exposure)

### 2. `src/orchestrator/pipeline.ts`

Core pipeline logic. All dependencies injected for testability.

**Dependencies type:**
```typescript
export type PipelineDeps = {
  discovery: MarketDiscovery;
  footballClient: FootballClient;
  registry: CompetitorRegistry;
  bettingService: BettingService;
  settlementService: SettlementService;
  marketsRepo: ReturnType<typeof marketsRepoFactory>;
  fixturesRepo: ReturnType<typeof fixturesRepoFactory>;
  predictionsRepo: ReturnType<typeof predictionsRepoFactory>;
  config: PipelineConfig;
};
```

**Exports:**
- `createPipeline(deps: PipelineDeps)` — returns `{ runPredictions, runSettlement }`

**`runPredictions()` flow:**

1. **Discover markets** — `discovery.discoverFootballMarkets()` → `Event[]`
2. **Persist markets** — upsert each market from each event into `marketsRepo`
3. **Fetch fixtures** — for each league in config, call `footballClient.getFixtures({ league, season, from: today, to: today + lookAheadDays })` → map with `mapApiFixtureToFixture`
4. **Persist fixtures** — upsert each into `fixturesRepo`
5. **Match** — `matchEventsToFixtures(events, fixtures)` → `MatchResult`
6. **For each matched fixture** (error-isolated, wrapped in try/catch):
   a. Fetch standings for the fixture's league/season → find both teams' stats
   b. Fetch H2H for the team pair
   c. For each matched market: build `MarketContext`, assemble `Statistics`
   d. Run all engines via `runAllEngines(registry.getAll(), statistics)`
   e. For each engine result, for each prediction:
      - Persist prediction to `predictionsRepo`
      - Call `bettingService.placeBet({ prediction, market, fixtureId, competitorId })`
7. **Return** `PredictionPipelineResult` with counts: fixtures processed, predictions made, bets placed/skipped/dry-run, errors

**`runSettlement()` flow:**

1. Call `settlementService.settleBets()`
2. Log results (settled count, skipped, errors)
3. Return the `SettlementResult`

**Error isolation:** Each matched fixture is processed in its own try/catch. A failure on one fixture (e.g., API-Football rate limit) does not abort others. Errors are collected and returned.

**Return types:**
```typescript
export type PredictionPipelineResult = {
  eventsDiscovered: number;
  fixturesFetched: number;
  fixturesMatched: number;
  fixturesProcessed: number;
  predictionsGenerated: number;
  betsPlaced: number;
  betsDryRun: number;
  betsSkipped: number;
  errors: string[];
};
```

### 3. `src/orchestrator/scheduler.ts`

Simple interval-based scheduler with overlap protection.

**Exports:**
- `createScheduler(pipeline: Pipeline)` — returns `{ start, stop }`

**Behavior:**
- `start()` — registers two `setInterval` timers (prediction + settlement). Runs each once immediately on start, then on the configured interval.
- `stop()` — clears both intervals
- **Overlap guard** — a boolean flag per loop. If a run is still in progress when the next interval fires, skip it and log a warning.
- Logs start/completion/skip of each run with duration.

### 4. `tests/unit/orchestrator/pipeline.test.ts`

Test the pipeline with fully mocked dependencies.

**Test cases:**
- Runs full prediction flow end-to-end with mocked services
- Persists markets to marketsRepo during discovery
- Persists fixtures to fixturesRepo during fetching
- Persists predictions to predictionsRepo after engine runs
- Calls bettingService.placeBet for each prediction
- Error in one fixture doesn't prevent processing others
- Returns correct counts in PredictionPipelineResult
- Settlement delegates to settlementService.settleBets
- Handles zero events gracefully (no crash, zeros in result)
- Handles zero matched fixtures gracefully
- Handles engine errors (EngineError) — logged but doesn't crash

### 5. `tests/unit/orchestrator/scheduler.test.ts`

Test scheduler start/stop and overlap protection.

**Test cases:**
- start() runs prediction and settlement immediately
- stop() clears intervals
- Overlap guard prevents concurrent prediction runs
- Overlap guard prevents concurrent settlement runs

---

## Files Modified

### `src/index.ts`

Wire up the full dependency graph and start the scheduler on server boot:

1. Parse env vars
2. Create DB connection
3. Create repos (markets, fixtures, predictions, bets)
4. Create clients (gamma, football, betting)
5. Create services (discovery, betting, settlement)
6. Create competitor registry, register baseline engine
7. Create pipeline with all deps
8. Create scheduler, call `start()`
9. On server shutdown, call `stop()`

---

## Not in Scope

- HTTP endpoints for manual triggers (future enhancement)
- Leaderboard / performance reporting (Feature 12)
- LLM competitor generation (Feature 11)
- Scoring beyond what settlement already provides

## Dependencies

No new packages.

## Verification

- [ ] `bun test` — all tests pass
- [ ] `bun run typecheck` — clean
- [ ] `bun run lint:fix` — clean
