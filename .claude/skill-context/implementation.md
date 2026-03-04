## Project: LLM Betting Competition — Implementation Context

Refer to `.claude/skill-context/planning.md` for full project overview, architecture, and tech stack. This file covers implementation-specific conventions and commands.

---

## Commands

```bash
bun test                          # Run all tests
bun test tests/unit/path/file.test.ts  # Run single test file
bun test --watch                  # Watch mode
bun run dev:api                   # Backend with --watch (port 3000)
cd ui && bun run dev              # Vite dev server (port 5173, proxies /api to 3000)
bun run build:ui                  # Build UI to ui/dist/
bunx biome check src/             # Lint + format check
bunx biome check --write src/     # Lint + format fix
bunx drizzle-kit generate         # Generate DB migration after schema change
bun run src/database/migrate.ts  # Apply migrations
```

**Type check:** Run `bunx tsc --noEmit` to check types. Fix all type errors before considering a task complete.

---

## Factory Function Pattern

All services and clients use factory functions, not classes:

```typescript
// Services
export function createBettingService(deps: {
  bettingClient: BettingClient;
  betsRepo: ReturnType<typeof betsRepoFactory>;
  config: BettingConfig;
}) {
  return {
    async placeBet(input: PlaceBetInput): Promise<PlaceBetResult> { ... }
  };
}

// Repositories
export function betsRepo(db: Database) {
  return {
    async create(data: NewBet): Promise<Bet> { ... },
    async findByStatus(status: BetStatus): Promise<Bet[]> { ... }
  };
}
```

Never use classes. Always use factory functions with typed dep objects.

---

## Repository Pattern

```typescript
// Always inject db — never import it directly
import { betsRepo } from "@database/repositories/bets";
const repo = betsRepo(db);
const bets = await repo.findByStatus("pending");
```

- Repos are in `src/database/repositories/`
- Each repo file exports one factory function named after the table
- Use `bulkUpsert` for batch writes, `upsert` for single rows with conflict handling

---

## Drizzle ORM Patterns

```typescript
// Insert
await db.insert(betsTable).values({ ... });

// Upsert (conflict on PK)
await db.insert(marketsTable).values(data)
  .onConflictDoUpdate({ target: marketsTable.id, set: { ...data } });

// Query with join
const result = await db
  .select({ bet: betsTable, market: marketsTable })
  .from(betsTable)
  .leftJoin(marketsTable, eq(betsTable.marketId, marketsTable.id))
  .where(eq(betsTable.status, "pending"));
```

**After any schema change**, run `bunx drizzle-kit generate` then apply the migration. Always check that existing data isn't broken by the change.

---

## Zod Patterns

```typescript
// Define schema with Zod v4
const mySchema = z.object({
  field: z.string(),
  optional: z.number().optional(),
});
type MyType = z.infer<typeof mySchema>;

// Validate (throws on failure — use in boundary code)
const data = mySchema.parse(rawInput);

// Safe parse (returns { success, data } or { success, error })
const result = mySchema.safeParse(rawInput);
```

Use Zod for: LLM output, API response parsing, env vars, engine output. Do not use it for internal data flow between typed TS functions.

---

## Testing Patterns

```typescript
import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mock a function
const mockFn = mock(() => Promise.resolve({ status: "placed" }));

// Mock a module
mock.module("@apis/polymarket/betting-client", () => ({
  createBettingClient: mock(() => ({ placeOrder: mockFn }))
}));

// In-memory SQLite for repo tests
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
const client = createClient({ url: "file::memory:" });
const db = drizzle(client, { schema });
// Run migrations before each test suite
```

Test file location mirrors source: `src/domain/services/betting.ts` → `tests/unit/domain/services/betting.test.ts`

---

## Path Aliases

Use path aliases — never use relative `../../` imports across module boundaries:

```typescript
import { Market } from "@domain/models/market";
import { env } from "@shared/env";
import { betsRepo } from "@database/repositories/bets";
import { runAllEngines } from "@engine/runner";
import { createWeightedEngine } from "@competitors/weight-tuned/engine";
import { createScheduler } from "@orchestrator/scheduler";
```

---

## Logging

```typescript
import { logger } from "@shared/logger";

logger.info("Pipeline started", { fixtures: 12 });
logger.warn("Market not found", { marketId });
logger.error("Bet placement failed", { error: err.message, marketId });
logger.debug("Engine output", { predictions });
```

Never use `console.log`. All structured data goes in the second argument.

---

## Environment Variables

Add new env vars to `src/shared/env.ts`:

```typescript
export const env = z.object({
  MY_NEW_VAR: z.string(),
  OPTIONAL_VAR: z.string().optional(),
}).parse(process.env);
```

Never access `process.env` directly anywhere except `src/shared/env.ts`.

---

## API Routes (Hono)

```typescript
// Route handler pattern
app.get("/api/resource", async (c) => {
  const items = await repo.findAll();
  return c.json({ items } satisfies MyResponseType);
});

// Test pattern — no real HTTP, no real DB
const mockRepo = { findAll: mock(() => Promise.resolve([])) };
const app = createApi({ ...allRepos, myRepo: mockRepo });
const res = await app.request("/api/resource");
const json = await res.json();
```

API types are in `src/shared/api-types.ts` — imported by both routes and UI. Always use `satisfies` or explicit return typing to keep them in sync.


**YOU MUST RUN ALL TESTS AND LINTING etc BEFORE RESOLVING**