## Project: LLM Betting Competition

A platform that pits LLMs against each other on Polymarket sports prediction markets. LLMs compete by tuning JSON weight configs for a shared prediction algorithm, not by writing arbitrary code. The system runs three independent loops (discovery, prediction, settlement) that communicate via the database.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript (strict mode) |
| Runtime | Bun (no build step, native TS) |
| Package manager | Bun |
| Test runner | Bun test (Jest-compatible API) |
| Linting/formatting | Biome (2-space indent, 100 char line width) |
| Validation | Zod v4 |
| API | Hono (`app.fetch` → `Bun.serve()`) |
| Database | Drizzle ORM + SQLite/libSQL (Turso) |
| Frontend | React 19 + Vite + TanStack Router |
| UI components | shadcn/ui + Tailwind |

---

## Key Architectural Patterns

**Factory functions everywhere** — no classes. Services are created with `createXxx(deps)`, repositories with `xxxRepo(db)`.

**Dependency injection via factory args** — all services receive their dependencies (db, clients, repos) as constructor args. This enables unit testing without real infrastructure.

**Repository pattern** — each DB table gets a `src/infrastructure/database/repositories/*.ts` file. Repos take a `db` instance and return typed CRUD methods.

**Zod at the boundaries** — schemas in `src/domain/contracts/` validate all external data (LLM output, API responses, engine output). Never trust unvalidated input.

**Feature plans live in `features/<kebab-name>/plan.md`** — always check whether a `research.md` already exists for the area before planning. If it does, read it first.

---

## Directory Structure (key paths)

```
src/
├── index.ts                    # Entry point: wires all components, starts scheduler, serves API + UI
├── api/routes/                 # Hono route handlers (GET only, read-only API)
├── domain/
│   ├── contracts/              # Zod schemas: Statistics, PredictionOutput, Reasoning
│   ├── models/                 # Domain types: Market, Fixture, Competitor, Bet, Prediction
│   ├── services/               # Business logic: betting, bankroll, settlement, market-matching
│   └── types/                  # Enums and compound types
├── engine/                     # PredictionEngine type, runner, Zod output validator
├── competitors/
│   └── weight-tuned/           # Shared algorithm with LLM-tuned JSON weights
├── infrastructure/
│   ├── database/               # Drizzle schema, client, migrations, repositories
│   ├── polymarket/             # Gamma client (discovery), CLOB betting client
│   ├── sports-data/            # API-Football client
│   └── openrouter/             # LLM client for weight generation
├── orchestrator/               # Discovery, prediction, settlement pipelines + scheduler
└── shared/                     # env (Zod-validated), logger, crypto, api-types
ui/src/                         # React SPA dashboard
tests/unit/                     # Mirrors src/ structure
```

---

## Database (Drizzle + Turso)

7 tables: `markets`, `fixtures`, `competitors`, `competitor_versions`, `competitor_wallets`, `predictions`, `bets`

- Migrations: `drizzle/` directory, generated with `bunx drizzle-kit generate`, applied with `bun run src/infrastructure/database/migrate.ts`
- Schema in `src/infrastructure/database/schema.ts`
- Drizzle config in `drizzle.config.ts`
- SQLite types: `integer({mode:"boolean"})`, `integer({mode:"timestamp"})`, `text({mode:"json"}).$type<T>()`
- Denormalised by design — fixtures store league and team names directly, no separate joins

---

## Testing Approach

- **Framework:** Bun test runner (Jest-compatible — `describe`, `it`, `expect`, `mock`, `beforeEach`)
- **Structure:** `tests/unit/` mirrors `src/` exactly
- **API tests:** call `app.request()` directly, inject mock repos — no real DB
- **Service tests:** pure functions with stub dependencies passed as factory args
- **Infrastructure tests:** repositories use in-memory SQLite via `createClient({url:"file::memory:"})`
- **Run:** `bun test` (all), `bun test path/to/file.test.ts` (single file)

---

## What Already Exists

All core infrastructure is built and working:
- Discovery pipeline (Gamma API → fixtures → DB)
- Prediction pipeline (DB → engines → Polymarket bets)
- Settlement loop (Gamma API → resolve markets → update bets)
- Weight-tuned competitor engine with LLM weight generation and iteration
- Full REST API with dashboard UI
- Encrypted per-competitor wallets

When planning new features, assume all the above is solid. Do not re-plan or re-design existing components unless the task explicitly requires modifying them.

---

## Conventions to Follow

- No CLAUDE.md in this repo — conventions are documented here and in `docs/research.md`
- Path aliases in `tsconfig.json`: `@domain/*`, `@shared/*`, `@infrastructure/*`, `@engine/*`, `@competitors/*`, `@orchestrator/*`
- Logging: `logger.info/warn/error/debug(msg, data?)` from `src/shared/logger.ts` — never `console.log`
- Environment: all env vars validated via Zod in `src/shared/env.ts` — add new vars there first
- Never expose wallet credentials, raw LLM output, or weight config code via the API
- The scheduler uses overlap prevention — pipelines must complete before next run starts
- **No N+1 queries** — never call a repository method inside a loop. Fetch data in bulk (using `inArray`, `findAll`, or a dedicated batch method), build a Map, then look up in memory. If a batch method doesn't exist, add one to the repo before using it in a loop.
