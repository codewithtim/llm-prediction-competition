# Feature 10: Pipeline Orchestration — Research

## Overview

Feature 10 wires all existing services (Features 3–9) into an automated pipeline: discover → match → stats → predict → bet → settle → score. The pipeline must handle errors per-step without crashing, support dry-run mode, and log structured output at each stage.

## Existing Components to Wire Together

### 1. Market Discovery (`src/infrastructure/polymarket/market-discovery.ts`)

```typescript
createMarketDiscovery(gamma: GammaClient) → {
  discoverFootballMarkets(): Promise<Event[]>   // main entry — discovers leagues, fetches events, deduplicates
  discoverFootballLeagues(): Promise<GammaSport[]>
  fetchActiveEvents(tagId: number, limit?: number): Promise<Event[]>
}
```

- No auth required (Gamma API is public)
- Returns `Event[]` with nested `Market[]` per event
- Handles pagination and deduplication across tags

### 2. Sports Data Client (`src/infrastructure/sports-data/client.ts`)

```typescript
createFootballClient(apiKey: string) → {
  getFixtures(params: FixtureParams): Promise<ApiResponse<ApiFixture[]>>
  getHeadToHead(teamId1: number, teamId2: number): Promise<ApiResponse<ApiFixture[]>>
  getStandings(league: number, season: number): Promise<ApiResponse<ApiStandingsResponse[]>>
}
```

- Requires `API_SPORTS_KEY`
- League IDs: EPL (39), La Liga (140), Serie A (135), Bundesliga (78), Ligue 1 (61)
- Free tier: 100 req/day, seasons 2022–2024 only

### 3. Market-Fixture Matching (`src/domain/services/market-matching.ts`)

```typescript
matchEventsToFixtures(events: Event[], fixtures: Fixture[]): MatchResult
// MatchResult = { matched: MatchedFixture[], unmatchedEvents: Event[], unmatchedFixtures: Fixture[] }
// MatchedFixture = { fixture: Fixture, markets: MatchedMarket[] }
```

- Matches by `gameId` first, then by team name + date
- Uses team name normalization and event title parsing

### 4. Prediction Engine (`src/engine/runner.ts`, `src/engine/validator.ts`)

```typescript
runEngine(registered: RegisteredEngine, statistics: Statistics): Promise<EngineResult | EngineError>
runAllEngines(engines: RegisteredEngine[], statistics: Statistics): Promise<Array<EngineResult | EngineError>>
```

- `EngineResult = { competitorId: string, predictions: PredictionOutput[] }`
- `EngineError = { competitorId: string, error: string }`
- Validates all output against Zod schema

### 5. Competitor Registry (`src/competitors/registry.ts`)

```typescript
createRegistry() → CompetitorRegistry {
  register(competitorId, name, engine): void
  getAll(): RegisteredEngine[]
  get(competitorId): RegisteredEngine | undefined
}
```

### 6. Betting Service (`src/domain/services/betting.ts`)

```typescript
createBettingService(deps: {
  bettingClient: BettingClient;
  betsRepo: ReturnType<typeof betsRepoFactory>;
  config: BettingConfig;  // { maxStakePerBet, maxTotalExposure, dryRun }
}) → {
  placeBet(input: PlaceBetInput): Promise<PlaceBetResult>
  // PlaceBetInput = { prediction, market, fixtureId, competitorId }
  // PlaceBetResult = { status: "placed" | "dry_run" | "skipped", bet?, reason? }
}
```

### 7. Settlement Service (`src/domain/services/settlement.ts`)

```typescript
createSettlementService(deps: {
  gammaClient: GammaClient;
  betsRepo: ReturnType<typeof betsRepoFactory>;
  marketsRepo: ReturnType<typeof marketsRepoFactory>;
}) → {
  settleBets(): Promise<SettlementResult>
  // SettlementResult = { settled: SettledBet[], skipped: number, errors: string[] }
}
```

### 8. Database Repositories

All follow `repoName(db: Database)` factory pattern:

| Repo | Key Methods |
|------|-------------|
| `competitorsRepo` | `findActive()`, `findById()` |
| `fixturesRepo` | `upsert()`, `findById()`, `findByStatus()` |
| `marketsRepo` | `upsert()`, `findById()`, `findActive()`, `findByGameId()` |
| `predictionsRepo` | `create()`, `findByFixtureAndCompetitor()` |
| `betsRepo` | `create()`, `findByStatus()`, `updateStatus()`, `getPerformanceStats()` |

### 9. Environment (`src/shared/env.ts`)

Key vars: `POLY_PRIVATE_KEY`, `POLY_API_KEY`, `POLY_API_SECRET`, `POLY_API_PASSPHRASE`, `API_SPORTS_KEY`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`

### 10. Logger (`src/shared/logger.ts`)

```typescript
logger.info(msg, data?), logger.warn(msg, data?), logger.error(msg, data?), logger.debug(msg, data?)
```

## Existing Reference: `src/scripts/test-pipeline.ts`

The test pipeline script already demonstrates the full flow end-to-end:
1. Discover football markets via Gamma API
2. Fetch fixtures for 5 leagues from API-Football
3. Match events to fixtures via `matchEventsToFixtures()`
4. Gather statistics (standings + H2H) and build `Statistics` object
5. Run the baseline engine via `runEngine()`
6. Print predictions

Key differences from the real pipeline:
- No DB persistence (in-memory only)
- No betting (predictions are printed, not placed)
- No settlement
- Single fixture processed (picks best match)
- Falls back to synthetic market when no real matches found

## Data Flow

```
GammaClient → MarketDiscovery.discoverFootballMarkets() → Event[]
                                                             │
FootballClient.getFixtures() → Fixture[]                     │
                                  │                          │
                                  ├──────────────────────────┘
                                  ↓
                    matchEventsToFixtures(events, fixtures)
                                  ↓
                          MatchedFixture[]
                                  │
         ┌────────────────────────┤
         │ For each MatchedFixture:
         │  - getStandings() → TeamStats
         │  - getHeadToHead() → H2H
         │  - Build MarketContext from market data
         │  → Statistics object
         ↓
  runAllEngines(engines, statistics)
         ↓
  EngineResult[] (PredictionOutput per engine per market)
         │
         │ For each prediction:
         │  bettingService.placeBet({ prediction, market, fixtureId, competitorId })
         ↓
  PlaceBetResult[]
         │
         │ (separate step, may run later)
         │  settlementService.settleBets()
         ↓
  SettlementResult
```

## Key Observations

1. **Statistics assembly is the most complex step** — requires fetching standings for the correct league/season, H2H for the specific team pair, and building MarketContext from the matched market. The test-pipeline script has working code for this.

2. **One Statistics object per fixture, but multiple markets per fixture** — a MatchedFixture can have multiple markets (home win, away win, draw). The engine receives one Statistics per fixture but may return predictions for multiple markets.

3. **Rate limiting** — API-Football free tier is 100 req/day. Each fixture needs ~3 requests (standings + H2H + fixture details). Pipeline must be aware of API budget.

4. **Settlement is independent** — can run separately from the predict→bet flow. Markets may not resolve for days after bets are placed.

5. **Error isolation** — each step (discovery, matching, stats, prediction, betting) should catch and log errors without aborting the entire pipeline. One failed fixture shouldn't prevent others from being processed.

6. **DB persistence at each stage** — markets should be upserted during discovery, fixtures during fetching, predictions during engine runs, bets during placement.
