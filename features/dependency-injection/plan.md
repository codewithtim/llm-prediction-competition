# Plan: Repository Port Interfaces (Dependency Injection Refactor)

**Date:** 2026-03-03
**Status:** Draft

---

## Overview

The codebase already uses a factory-function DI pattern (`createX(deps: XDeps)`) for all services and pipelines. However, repository dependencies are typed as `ReturnType<typeof repoFactory>`, which forces domain-layer files to import from the infrastructure layer just for type information, and forces tests to use `as unknown as` casts when providing mocks. This plan introduces named repository port interfaces in `src/domain/ports/repositories.ts` that cleanly separate the contract from the implementation.

---

## Approach

Define a single `src/domain/ports/repositories.ts` file that exports:
1. **Row types** — type aliases from Drizzle's `$inferSelect`/`$inferInsert` (keeps schema as the single source of truth)
2. **Repository interfaces** — one per repository, with `Promise<void>` on all write methods (since return values are never used by callers) and typed row arrays on read methods

Then update every consumer (5 domain services, 2 orchestrator pipelines, API) and every affected test file to reference these interfaces instead of `ReturnType<typeof repoFactory>`.

The concrete `*Repo(db)` factory functions already satisfy the interfaces via TypeScript structural typing — no changes to their implementation are needed.

### Trade-offs

**What this gives up:**
- The concrete return types of write operations (e.g. Drizzle's `RunResult`) are hidden behind `Promise<void>`. In practice no caller uses these values, so this is zero functional cost.
- `BetRow["errorCategory"]` is `string | null` in the interface (as Drizzle infers it), not the narrower `BetErrorCategory` union. Callers that need the narrower type can assert or cast at the call site, the same as today.

**Risks:**
- If a repo gains a new method that's called somewhere, it must also be added to the interface. This is low friction but requires discipline.

---

## Changes Required

### `src/domain/ports/repositories.ts` *(new file)*

Exports all row types and repository interfaces. Row types are derived from the Drizzle schema so they stay in sync automatically.

```typescript
import type {
  bets, competitors, competitorVersions,
  fixtures, markets, predictions,
} from "../../infrastructure/database/schema";
import type { CompetitorStatus } from "../types/competitor";
import type { WalletConfig } from "../types/competitor";

// ── Row and insert types ──────────────────────────────────────────────
export type BetRow    = typeof bets.$inferSelect;
export type BetInsert = typeof bets.$inferInsert;
export type MarketRow    = typeof markets.$inferSelect;
export type MarketInsert = typeof markets.$inferInsert;
export type FixtureRow    = typeof fixtures.$inferSelect;
export type FixtureInsert = typeof fixtures.$inferInsert;
export type PredictionRow    = typeof predictions.$inferSelect;
export type PredictionInsert = typeof predictions.$inferInsert;
export type CompetitorRow    = typeof competitors.$inferSelect;
export type CompetitorInsert = typeof competitors.$inferInsert;
export type CompetitorVersionRow    = typeof competitorVersions.$inferSelect;
export type CompetitorVersionInsert = typeof competitorVersions.$inferInsert;

export type WalletListEntry = {
  competitorId: string;
  walletAddress: string;
  createdAt: Date | null;
};

export type PerformanceStats = {
  competitorId: string;
  totalBets: number;
  wins: number;
  losses: number;
  pending: number;
  failed: number;
  lockedAmount: number;
  totalStaked: number;
  totalReturned: number;
  profitLoss: number;
  accuracy: number;
  roi: number;
};

// ── Repository interfaces ─────────────────────────────────────────────
export interface BetsRepository {
  create(bet: BetInsert): Promise<void>;
  findById(id: string): Promise<BetRow | undefined>;
  findAll(): Promise<BetRow[]>;
  findRecent(limit: number): Promise<BetRow[]>;
  findByCompetitor(competitorId: string): Promise<BetRow[]>;
  findByStatus(status: BetRow["status"]): Promise<BetRow[]>;
  updateStatus(id: string, status: BetRow["status"], settledAt?: Date, profit?: number): Promise<void>;
  updateBetAfterSubmission(
    id: string,
    update:
      | { status: "pending"; orderId: string }
      | { status: "failed"; errorMessage: string; errorCategory: string; attempts: number; lastAttemptAt: Date },
  ): Promise<void>;
  findRetryableBets(maxAttempts: number, minRetryDelayMs?: number): Promise<BetRow[]>;
  getPerformanceStats(competitorId: string): Promise<PerformanceStats>;
}

export interface MarketsRepository {
  upsert(market: MarketInsert): Promise<void>;
  bulkUpsert(markets: MarketInsert[]): Promise<void>;
  findAll(): Promise<MarketRow[]>;
  findById(id: string): Promise<MarketRow | undefined>;
  findActive(): Promise<MarketRow[]>;
  findByGameId(gameId: string): Promise<MarketRow[]>;
  findByFixtureId(fixtureId: number): Promise<MarketRow[]>;
  findActiveWithFixture(): Promise<MarketRow[]>;
}

export interface FixturesRepository {
  upsert(fixture: FixtureInsert): Promise<void>;
  bulkUpsert(fixtures: FixtureInsert[]): Promise<void>;
  findAll(): Promise<FixtureRow[]>;
  findById(id: number): Promise<FixtureRow | undefined>;
  findByStatus(status: FixtureRow["status"]): Promise<FixtureRow[]>;
  findScheduledUpcoming(): Promise<FixtureRow[]>;
}

export interface PredictionsRepository {
  create(prediction: PredictionInsert): Promise<void>;
  findAll(): Promise<PredictionRow[]>;
  findRecent(limit: number): Promise<PredictionRow[]>;
  findByCompetitor(competitorId: string): Promise<PredictionRow[]>;
  findByMarket(marketId: string): Promise<PredictionRow[]>;
  findByFixtureAndCompetitor(fixtureId: number, competitorId: string): Promise<PredictionRow[]>;
}

export interface CompetitorsRepository {
  create(competitor: CompetitorInsert): Promise<void>;
  findById(id: string): Promise<CompetitorRow | undefined>;
  findAll(): Promise<CompetitorRow[]>;
  findByStatus(status: CompetitorStatus): Promise<CompetitorRow[]>;
  setStatus(id: string, status: CompetitorStatus): Promise<void>;
  updateEnginePath(id: string, enginePath: string): Promise<void>;
}

export interface CompetitorVersionsRepository {
  create(version: CompetitorVersionInsert): Promise<void>;
  findByCompetitor(competitorId: string): Promise<CompetitorVersionRow[]>;
  findLatest(competitorId: string): Promise<CompetitorVersionRow | undefined>;
  findByVersion(competitorId: string, version: number): Promise<CompetitorVersionRow | undefined>;
}

export interface WalletsRepository {
  listAll(): Promise<WalletListEntry[]>;
  findByCompetitorId(competitorId: string, encryptionKey: string): Promise<(WalletConfig & { walletAddress: string }) | null>;
  create(competitorId: string, walletAddress: string, walletConfig: WalletConfig, encryptionKey: string): Promise<void>;
  delete(competitorId: string): Promise<void>;
}
```

### `src/domain/services/betting.ts`

Replace:
```typescript
import type { betsRepo as betsRepoFactory } from "../../infrastructure/database/repositories/bets";
// ...
betsRepo: ReturnType<typeof betsRepoFactory>;
```
With:
```typescript
import type { BetsRepository } from "../ports/repositories";
// ...
betsRepo: BetsRepository;
```

### `src/domain/services/bankroll.ts`

Same replacement: `ReturnType<typeof betsRepoFactory>` → `BetsRepository`.

Remove the infrastructure import, add ports import.

### `src/domain/services/settlement.ts`

Replace both:
```typescript
import type { betsRepo as betsRepoFactory } from "../../infrastructure/database/repositories/bets";
import type { marketsRepo as marketsRepoFactory } from "../../infrastructure/database/repositories/markets";
// ...
betsRepo: ReturnType<typeof betsRepoFactory>;
marketsRepo: ReturnType<typeof marketsRepoFactory>;
```
With:
```typescript
import type { BetsRepository, MarketsRepository } from "../ports/repositories";
// ...
betsRepo: BetsRepository;
marketsRepo: MarketsRepository;
```

### `src/domain/services/bet-retry.ts`

Replace `betsRepo: ReturnType<typeof betsRepoFactory>` → `betsRepo: BetsRepository`. Remove the infrastructure import.

### `src/domain/services/order-confirmation.ts`

Same as `bet-retry.ts`.

### `src/orchestrator/discovery-pipeline.ts`

Replace:
```typescript
import type { fixturesRepo as fixturesRepoFactory } from "../infrastructure/database/repositories/fixtures.ts";
import type { marketsRepo as marketsRepoFactory } from "../infrastructure/database/repositories/markets.ts";
// ...
marketsRepo: ReturnType<typeof marketsRepoFactory>;
fixturesRepo: ReturnType<typeof fixturesRepoFactory>;
```
With:
```typescript
import type { FixturesRepository, MarketsRepository } from "../domain/ports/repositories.ts";
// ...
marketsRepo: MarketsRepository;
fixturesRepo: FixturesRepository;
```

Also remove the now-unused `import type { fixtures as fixturesTable, markets as marketsTable }` from the schema (currently used for the `$inferSelect` row types in the function bodies) — these become `FixtureRow` and `MarketRow` from ports.

### `src/orchestrator/prediction-pipeline.ts`

Replace the three `ReturnType<typeof *repoFactory>` usages:
```typescript
marketsRepo: MarketsRepository;
fixturesRepo: FixturesRepository;
predictionsRepo: PredictionsRepository;
```
And remove the three corresponding infrastructure imports. The `import type { fixtures as fixturesTable, markets as marketsTable }` from schema (used for `$inferSelect` row types in function bodies) is replaced by `FixtureRow` / `MarketRow` from ports.

### `src/api/index.ts`

Replace `ApiDeps` to use interface types:
```typescript
import type {
  BetsRepository,
  CompetitorVersionsRepository,
  CompetitorsRepository,
  FixturesRepository,
  MarketsRepository,
  PredictionsRepository,
  WalletsRepository,
} from "../domain/ports/repositories.ts";

export type ApiDeps = {
  competitorsRepo: CompetitorsRepository;
  competitorVersionsRepo: CompetitorVersionsRepository;
  betsRepo: BetsRepository;
  predictionsRepo: PredictionsRepository;
  marketsRepo: MarketsRepository;
  fixturesRepo: FixturesRepository;
  walletsRepo: WalletsRepository;
};
```
Remove all seven `import type { *Repo }` infrastructure imports.

### `tests/unit/domain/services/betting.test.ts`

Remove:
```typescript
import type { betsRepo as betsRepoFactory } from "../../../../src/infrastructure/database/repositories/bets";
type BetsRepo = ReturnType<typeof betsRepoFactory>;
```
Add:
```typescript
import type { BetsRepository } from "../../../../src/domain/ports/repositories";
```
Update mock builder return type from `BetsRepo` → `BetsRepository`, removing any `as unknown as` casts.

### `tests/unit/domain/services/settlement.test.ts`

Remove infrastructure imports and the manually-duplicated `BetRow` / `MarketRow` type definitions. Import them from ports instead:
```typescript
import type { BetsRepository, MarketsRepository, BetRow, MarketRow } from "../../../../src/domain/ports/repositories";
```
Remove `as unknown as BetsRepo` / `as unknown as MarketsRepo` casts from mock builders.

### `tests/unit/domain/services/bankroll.test.ts`

Remove `import type { betsRepo as betsRepoFactory }` and `type BetsRepo = ReturnType<...>`. Import `BetsRepository` from ports instead.

### `tests/unit/domain/services/bet-retry.test.ts`

Same pattern as bankroll.

### `tests/unit/domain/services/order-confirmation.test.ts`

Same pattern as bankroll.

### `tests/unit/orchestrator/pipeline.test.ts`

The mock functions `mockMarketsRepo`, `mockFixturesRepo`, `mockPredictionsRepo` currently return plain objects cast with `as unknown as DiscoveryPipelineDeps["marketsRepo"]`. After this change, they can be typed directly:

```typescript
import type { FixturesRepository, MarketsRepository, PredictionsRepository } from "../../../src/domain/ports/repositories";

function mockMarketsRepo(overrides = {}): MarketsRepository { ... }
function mockFixturesRepo(overrides = {}): FixturesRepository { ... }
function mockPredictionsRepo(overrides = {}): PredictionsRepository { ... }
```

Remove all `as unknown as DiscoveryPipelineDeps[...]` and `as unknown as PredictionPipelineDeps[...]` casts in `buildDiscoveryDeps` and `buildPredictionDeps`.

---

## Data & Migration

No database schema changes. No data migration required.

---

## Test Plan

No new test cases are needed — the existing suite covers all behaviour. The goal is to make existing tests cleaner by removing infrastructure imports and type casts.

After implementation, run the full test suite to confirm no regressions:
```
bun test
```

Key assertions to verify manually:
- All 5 service test files compile without `as unknown as` casts on repo mocks
- Pipeline test file compiles without `as unknown as` casts on `buildDiscoveryDeps` / `buildPredictionDeps`
- `src/domain/services/*.ts` files no longer import from `../../infrastructure/database/repositories/`
- `src/orchestrator/*.ts` files no longer import from `../infrastructure/database/repositories/`

---

## Task Breakdown

- [ ] Create directory `features/dependency-injection/` (already done)
- [ ] Create `src/domain/ports/repositories.ts` with all row types, `PerformanceStats`, `WalletListEntry`, and the 7 repository interfaces
- [ ] Update `src/domain/services/betting.ts`: swap infra import for `BetsRepository` from ports
- [ ] Update `src/domain/services/bankroll.ts`: swap infra import for `BetsRepository` from ports
- [ ] Update `src/domain/services/settlement.ts`: swap two infra imports for `BetsRepository` + `MarketsRepository` from ports
- [ ] Update `src/domain/services/bet-retry.ts`: swap infra import for `BetsRepository` from ports
- [ ] Update `src/domain/services/order-confirmation.ts`: swap infra import for `BetsRepository` from ports
- [ ] Update `src/orchestrator/discovery-pipeline.ts`: swap two infra repo imports for `MarketsRepository` + `FixturesRepository`; replace `ReturnType<typeof *Table.$inferSelect>` with `MarketRow` / `FixtureRow` from ports
- [ ] Update `src/orchestrator/prediction-pipeline.ts`: swap three infra repo imports for `MarketsRepository`, `FixturesRepository`, `PredictionsRepository`; replace schema row type usages with port types
- [ ] Update `src/api/index.ts`: rewrite `ApiDeps` to use all 7 repository interfaces; remove 7 infra imports
- [ ] Update `tests/unit/domain/services/betting.test.ts`: remove infra import, use `BetsRepository` from ports
- [ ] Update `tests/unit/domain/services/bankroll.test.ts`: same
- [ ] Update `tests/unit/domain/services/bet-retry.test.ts`: same
- [ ] Update `tests/unit/domain/services/order-confirmation.test.ts`: same
- [ ] Update `tests/unit/domain/services/settlement.test.ts`: remove infra imports + manual `BetRow`/`MarketRow` type definitions; import from ports
- [ ] Update `tests/unit/orchestrator/pipeline.test.ts`: type mock builders with repo interfaces; remove all `as unknown as *Deps["*Repo"]` casts
- [ ] Run `bun test` and confirm all tests pass
- [ ] Run `bun run typecheck` (or equivalent) to confirm zero TypeScript errors
