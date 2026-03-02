# Plan: Feature 2 — Database Schema & Repositories

Scope: Drizzle schema for all domain entities, repository functions for CRUD, and initial migration. No API calls, no business logic beyond data access.

---

## 1. Schema

All tables defined in `src/infrastructure/database/schema.ts` using `drizzle-orm/sqlite-core`.

### Markets table

```typescript
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const markets = sqliteTable("markets", {
  id: text("id").primaryKey(),
  conditionId: text("condition_id").notNull(),
  slug: text("slug").notNull(),
  question: text("question").notNull(),
  outcomes: text("outcomes", { mode: "json" }).notNull().$type<[string, string]>(),
  outcomePrices: text("outcome_prices", { mode: "json" }).notNull().$type<[string, string]>(),
  tokenIds: text("token_ids", { mode: "json" }).notNull().$type<[string, string]>(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  closed: integer("closed", { mode: "boolean" }).notNull().default(false),
  acceptingOrders: integer("accepting_orders", { mode: "boolean" }).notNull().default(true),
  liquidity: real("liquidity").notNull().default(0),
  volume: real("volume").notNull().default(0),
  gameId: text("game_id"),
  sportsMarketType: text("sports_market_type"),
  line: real("line"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
```

Tuple fields (`outcomes`, `outcomePrices`, `tokenIds`) use `text` with `mode: "json"` and `$type<>()` to get correct TypeScript types. SQLite stores them as JSON strings.

### Fixtures table

```typescript
export const fixtures = sqliteTable("fixtures", {
  id: integer("id").primaryKey(),
  leagueId: integer("league_id").notNull(),
  leagueName: text("league_name").notNull(),
  leagueCountry: text("league_country").notNull(),
  leagueSeason: integer("league_season").notNull(),
  homeTeamId: integer("home_team_id").notNull(),
  homeTeamName: text("home_team_name").notNull(),
  homeTeamLogo: text("home_team_logo"),
  awayTeamId: integer("away_team_id").notNull(),
  awayTeamName: text("away_team_name").notNull(),
  awayTeamLogo: text("away_team_logo"),
  date: text("date").notNull(),
  venue: text("venue"),
  status: text("status", {
    enum: ["scheduled", "in_progress", "finished", "postponed", "cancelled"],
  }).notNull().default("scheduled"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
```

League and team data denormalised — no separate tables. These are reference data from API-Sports, always read together with the fixture.

### Competitors table

```typescript
export const competitors = sqliteTable("competitors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  model: text("model").notNull(),
  enginePath: text("engine_path").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
```

### Predictions table

```typescript
export const predictions = sqliteTable("predictions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  marketId: text("market_id").notNull().references(() => markets.id),
  fixtureId: integer("fixture_id").notNull().references(() => fixtures.id),
  competitorId: text("competitor_id").notNull().references(() => competitors.id),
  side: text("side", { enum: ["YES", "NO"] }).notNull(),
  confidence: real("confidence").notNull(),
  stake: real("stake").notNull(),
  reasoning: text("reasoning").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
```

### Bets table

```typescript
export const bets = sqliteTable("bets", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  marketId: text("market_id").notNull().references(() => markets.id),
  fixtureId: integer("fixture_id").notNull().references(() => fixtures.id),
  competitorId: text("competitor_id").notNull().references(() => competitors.id),
  tokenId: text("token_id").notNull(),
  side: text("side", { enum: ["YES", "NO"] }).notNull(),
  amount: real("amount").notNull(),
  price: real("price").notNull(),
  shares: real("shares").notNull(),
  status: text("status", {
    enum: ["pending", "filled", "settled_won", "settled_lost", "cancelled"],
  }).notNull().default("pending"),
  placedAt: integer("placed_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  settledAt: integer("settled_at", { mode: "timestamp" }),
  profit: real("profit"),
});
```

---

## 2. Database client

A shared `db` instance and client factory for repositories. Lives in `src/infrastructure/database/client.ts`.

```typescript
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

export function createDb(url: string, authToken: string) {
  const client = createClient({ url, authToken });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;
```

This lets repositories accept a `Database` instance — in production it connects to Turso, in tests it connects to a local in-memory libSQL.

---

## 3. Repositories

Each table gets a repository file in `src/infrastructure/database/repositories/`. Repositories are plain functions that take a `Database` and return typed results.

### `src/infrastructure/database/repositories/markets.ts`

```typescript
import { eq } from "drizzle-orm";
import type { Database } from "../client";
import { markets } from "../schema";

export function marketsRepo(db: Database) {
  return {
    async upsert(market: typeof markets.$inferInsert) {
      return db.insert(markets).values(market).onConflictDoUpdate({
        target: markets.id,
        set: {
          outcomePrices: market.outcomePrices,
          active: market.active,
          closed: market.closed,
          acceptingOrders: market.acceptingOrders,
          liquidity: market.liquidity,
          volume: market.volume,
          updatedAt: new Date(),
        },
      });
    },

    async findById(id: string) {
      return db.select().from(markets).where(eq(markets.id, id)).get();
    },

    async findActive() {
      return db.select().from(markets).where(eq(markets.active, true)).all();
    },

    async findByGameId(gameId: string) {
      return db.select().from(markets).where(eq(markets.gameId, gameId)).all();
    },
  };
}
```

**Why upsert?** Markets are fetched repeatedly from Polymarket. Prices, liquidity, and status change — we want to update existing rows, not duplicate them.

### `src/infrastructure/database/repositories/fixtures.ts`

```typescript
import { eq } from "drizzle-orm";
import type { Database } from "../client";
import { fixtures } from "../schema";

export function fixturesRepo(db: Database) {
  return {
    async upsert(fixture: typeof fixtures.$inferInsert) {
      return db.insert(fixtures).values(fixture).onConflictDoUpdate({
        target: fixtures.id,
        set: {
          status: fixture.status,
          venue: fixture.venue,
          updatedAt: new Date(),
        },
      });
    },

    async findById(id: number) {
      return db.select().from(fixtures).where(eq(fixtures.id, id)).get();
    },

    async findByStatus(status: string) {
      return db.select().from(fixtures).where(eq(fixtures.status, status)).all();
    },
  };
}
```

### `src/infrastructure/database/repositories/competitors.ts`

```typescript
import { eq } from "drizzle-orm";
import type { Database } from "../client";
import { competitors } from "../schema";

export function competitorsRepo(db: Database) {
  return {
    async create(competitor: typeof competitors.$inferInsert) {
      return db.insert(competitors).values(competitor);
    },

    async findById(id: string) {
      return db.select().from(competitors).where(eq(competitors.id, id)).get();
    },

    async findActive() {
      return db.select().from(competitors).where(eq(competitors.active, true)).all();
    },

    async setActive(id: string, active: boolean) {
      return db.update(competitors).set({ active }).where(eq(competitors.id, id));
    },
  };
}
```

### `src/infrastructure/database/repositories/predictions.ts`

```typescript
import { and, eq } from "drizzle-orm";
import type { Database } from "../client";
import { predictions } from "../schema";

export function predictionsRepo(db: Database) {
  return {
    async create(prediction: typeof predictions.$inferInsert) {
      return db.insert(predictions).values(prediction);
    },

    async findByCompetitor(competitorId: string) {
      return db.select().from(predictions).where(eq(predictions.competitorId, competitorId)).all();
    },

    async findByMarket(marketId: string) {
      return db.select().from(predictions).where(eq(predictions.marketId, marketId)).all();
    },

    async findByFixtureAndCompetitor(fixtureId: number, competitorId: string) {
      return db
        .select()
        .from(predictions)
        .where(and(eq(predictions.fixtureId, fixtureId), eq(predictions.competitorId, competitorId)))
        .all();
    },
  };
}
```

### `src/infrastructure/database/repositories/bets.ts`

```typescript
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../client";
import { bets } from "../schema";

export function betsRepo(db: Database) {
  return {
    async create(bet: typeof bets.$inferInsert) {
      return db.insert(bets).values(bet);
    },

    async findById(id: string) {
      return db.select().from(bets).where(eq(bets.id, id)).get();
    },

    async findByCompetitor(competitorId: string) {
      return db.select().from(bets).where(eq(bets.competitorId, competitorId)).all();
    },

    async findByStatus(status: string) {
      return db.select().from(bets).where(eq(bets.status, status)).all();
    },

    async updateStatus(id: string, status: string, settledAt?: Date, profit?: number) {
      return db
        .update(bets)
        .set({ status, settledAt: settledAt ?? null, profit: profit ?? null })
        .where(eq(bets.id, id));
    },

    async getPerformanceStats(competitorId: string) {
      const rows = await db.select().from(bets).where(eq(bets.competitorId, competitorId)).all();

      const wins = rows.filter((r) => r.status === "settled_won").length;
      const losses = rows.filter((r) => r.status === "settled_lost").length;
      const pending = rows.filter((r) => r.status === "pending" || r.status === "filled").length;
      const totalStaked = rows.reduce((sum, r) => sum + r.amount, 0);
      const totalReturned = rows
        .filter((r) => r.profit !== null)
        .reduce((sum, r) => sum + r.amount + (r.profit ?? 0), 0);

      return {
        competitorId,
        totalBets: rows.length,
        wins,
        losses,
        pending,
        totalStaked,
        totalReturned,
        profitLoss: totalReturned - totalStaked,
        accuracy: wins + losses > 0 ? wins / (wins + losses) : 0,
        roi: totalStaked > 0 ? (totalReturned - totalStaked) / totalStaked : 0,
      };
    },
  };
}
```

`getPerformanceStats` computes `PerformanceStats` from the bets table — no separate stats table needed.

---

## 4. Update migrate.ts

The existing `migrate.ts` reads env vars directly. Update it to use the `createDb` helper for consistency.

```typescript
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set");
  process.exit(1);
}

const client = createClient({ url, authToken });
const db = drizzle(client);

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations complete");
process.exit(0);
```

No change needed — the migrate script stays standalone (it shouldn't import the schema-aware client since it runs migrations before the schema exists).

---

## 5. Tests

### `tests/unit/infrastructure/database/repositories/markets.test.ts`

Test against an in-memory libSQL database.

```typescript
import { beforeEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "../../../../../src/infrastructure/database/schema";
import { marketsRepo } from "../../../../../src/infrastructure/database/repositories/markets";

let db: ReturnType<typeof drizzle>;

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
});

describe("marketsRepo", () => {
  const repo = () => marketsRepo(db);

  const sampleMarket = {
    id: "market-1",
    conditionId: "cond-1",
    slug: "arsenal-vs-chelsea",
    question: "Will Arsenal win?",
    outcomes: ["Yes", "No"] as [string, string],
    outcomePrices: ["0.65", "0.35"] as [string, string],
    tokenIds: ["token-yes", "token-no"] as [string, string],
    active: true,
    closed: false,
    acceptingOrders: true,
    liquidity: 50000,
    volume: 120000,
    gameId: "game-123",
    sportsMarketType: "moneyline",
    line: null,
  };

  it("inserts and retrieves a market", async () => {
    await repo().upsert(sampleMarket);
    const found = await repo().findById("market-1");
    expect(found?.question).toBe("Will Arsenal win?");
    expect(found?.outcomes).toEqual(["Yes", "No"]);
  });

  it("updates on conflict", async () => {
    await repo().upsert(sampleMarket);
    await repo().upsert({ ...sampleMarket, liquidity: 99999 });
    const found = await repo().findById("market-1");
    expect(found?.liquidity).toBe(99999);
  });

  it("finds active markets", async () => {
    await repo().upsert(sampleMarket);
    await repo().upsert({ ...sampleMarket, id: "market-2", active: false });
    const active = await repo().findActive();
    expect(active).toHaveLength(1);
  });
});
```

Similar test files for fixtures, competitors, predictions, and bets repos. Each uses an in-memory libSQL client with migrations applied in `beforeEach`.

---

## 6. Files to create

| File | Purpose |
|------|---------|
| `src/infrastructure/database/client.ts` | `createDb` factory + `Database` type |
| `src/infrastructure/database/repositories/markets.ts` | Markets CRUD + upsert |
| `src/infrastructure/database/repositories/fixtures.ts` | Fixtures CRUD + upsert |
| `src/infrastructure/database/repositories/competitors.ts` | Competitors CRUD |
| `src/infrastructure/database/repositories/predictions.ts` | Predictions CRUD |
| `src/infrastructure/database/repositories/bets.ts` | Bets CRUD + performance stats |
| `tests/unit/infrastructure/database/repositories/markets.test.ts` | Markets repo tests |
| `tests/unit/infrastructure/database/repositories/fixtures.test.ts` | Fixtures repo tests |
| `tests/unit/infrastructure/database/repositories/competitors.test.ts` | Competitors repo tests |
| `tests/unit/infrastructure/database/repositories/predictions.test.ts` | Predictions repo tests |
| `tests/unit/infrastructure/database/repositories/bets.test.ts` | Bets repo tests |

## 7. Files to modify

| File | Change |
|------|--------|
| `src/infrastructure/database/schema.ts` | Replace placeholder comment with full schema (5 tables) |

---

## 8. Design decisions

1. **Denormalised fixtures.** League and team data stored inline. No `leagues` or `teams` tables — they'd add joins for zero benefit since this data is always read with the fixture.

2. **JSON text columns for tuples.** `outcomes`, `outcomePrices`, `tokenIds` are always read/written as pairs. Storing them as JSON text avoids extra columns and keeps the schema simple.

3. **PerformanceStats computed, not stored.** Derived from the bets table via `getPerformanceStats()`. Avoids stale data and denormalisation bugs.

4. **Upsert for markets and fixtures.** These entities are fetched repeatedly from external APIs. Upsert prevents duplicates and keeps data fresh.

5. **In-memory libSQL for tests.** `createClient({ url: ":memory:" })` gives us a clean database per test run. Migrations are applied in `beforeEach` so tests start with the correct schema.

6. **`createDb` factory.** Repositories take a `Database` type, not a global singleton. This makes testing trivial — pass in-memory DB in tests, real Turso connection in production.

---

## Todo List

### Phase 1: Schema

- [x] 1.1 Replace `src/infrastructure/database/schema.ts` placeholder with full schema (markets, fixtures, competitors, predictions, bets tables)
- [x] 1.2 Create `src/infrastructure/database/client.ts` — `createDb` factory + `Database` type export

### Phase 2: Generate migration

- [x] 2.1 Run `bun run db:generate` to generate the initial migration SQL in `./drizzle/`

### Phase 3: Repositories

- [x] 3.1 Create `src/infrastructure/database/repositories/markets.ts` — upsert, findById, findActive, findByGameId
- [x] 3.2 Create `src/infrastructure/database/repositories/fixtures.ts` — upsert, findById, findByStatus
- [x] 3.3 Create `src/infrastructure/database/repositories/competitors.ts` — create, findById, findActive, setActive
- [x] 3.4 Create `src/infrastructure/database/repositories/predictions.ts` — create, findByCompetitor, findByMarket, findByFixtureAndCompetitor
- [x] 3.5 Create `src/infrastructure/database/repositories/bets.ts` — create, findById, findByCompetitor, findByStatus, updateStatus, getPerformanceStats

### Phase 4: Tests

- [x] 4.1 Create `tests/unit/infrastructure/database/repositories/markets.test.ts`
- [x] 4.2 Create `tests/unit/infrastructure/database/repositories/fixtures.test.ts`
- [x] 4.3 Create `tests/unit/infrastructure/database/repositories/competitors.test.ts`
- [x] 4.4 Create `tests/unit/infrastructure/database/repositories/predictions.test.ts`
- [x] 4.5 Create `tests/unit/infrastructure/database/repositories/bets.test.ts`

### Phase 5: Verification

- [x] 5.1 Run `bun run typecheck` — all types compile cleanly
- [x] 5.2 Run `bun test` — all tests pass
- [x] 5.3 Run `bun run lint` — no lint errors
