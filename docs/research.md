# LLM Betting Competition — Research & Proposal

## Overview

A platform that pits LLMs against each other in sports prediction markets on Polymarket. Each LLM writes and iterates on its own prediction engine code, which consumes strongly-typed sports statistics and outputs betting decisions. The system places bets on Polymarket, tracks results, and feeds outcomes back to each LLM so it can evolve its strategy.

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Language | TypeScript (strict mode) | Strong typing for the stats contracts, good Polymarket SDK support |
| Runtime | Bun | Native TS execution (no build step), 2-4x faster than Node, built-in test runner. Owned by Anthropic — long-term support guaranteed |
| Package Manager | Bun (built-in) | 3-5x faster installs than pnpm, zero additional tooling |
| Testing | Bun test runner | Built-in, Jest-compatible API, extremely fast (~10x Vitest). No config needed |
| Linting/Formatting | Biome | Fast all-in-one linter and formatter. Configured with 2-space indent, 100 char line width, recommended rules, import organising |
| Validation | Zod (v4) | Runtime type validation for API responses and LLM-generated code contracts |
| Polymarket SDK | `@polymarket/clob-client` + `ethers` | Official TypeScript client. `ethers` provides wallet and EIP-712 signing for order placement |
| Sports Data | API-Sports ecosystem | $19/mo per sport, typed responses, good coverage |
| LLM Integration | OpenRouter via `@openrouter/sdk` | Single API key for all models (Claude, GPT-4, Gemini, etc.). Official TypeScript SDK (pinned version). Model switching is just changing a string |
| Database | Turso (hosted libSQL) + Drizzle ORM + Drizzle Kit | Managed distributed SQLite — free tier covers our usage (5GB, 500M reads/mo). Drizzle Kit handles schema generation and migrations |
| LLM Code Lifecycle | Generate → test → commit → run | LLMs write prediction engines that are committed to the repo. No sandboxing — code is reviewed and tested before running |

### Deployment

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Hosting | DigitalOcean Droplet ($4-6/mo) | Simple VM, full control, cheap |
| Container | Docker via GHCR | Multi-stage Bun image. Built and pushed to GitHub Container Registry, pulled and run on the Droplet with `--env-file /opt/llm-betting/.env` |
| Database | Turso free tier | Hosted libSQL (SQLite fork). Connects via URL — no local file persistence needed, so ephemeral containers or Droplets both work |
| Estimated monthly cost | ~$25-45 | Droplet ($6) + API-Sports ($19/sport) + Turso (free) |

### CI/CD

| Workflow | Trigger | Steps |
|----------|---------|-------|
| **CI** (`.github/workflows/ci.yml`) | Push/PR to `main` | Install → Lint (Biome) → Typecheck (`tsc --noEmit`) → Test (`bun test`) |
| **Deploy** (`.github/workflows/deploy.yml`) | Manual (`workflow_dispatch`, type "deploy" to confirm) | Build Docker image → Push to GHCR → SSH to Droplet → Pull and restart container |
| **Migrations** (`.github/workflows/migrate.yml`) | Manual (`workflow_dispatch`, type "migrate" to confirm) | Install → Run `bun run db:migrate` with Turso credentials from secrets |

### Authentication & Secrets

All secrets stored as environment variables on the DigitalOcean Droplet. Never committed to the repo.

```
# Polymarket — Polygon wallet (chain ID 137, funded with USDC)
POLY_PRIVATE_KEY=0x...          # Polygon wallet private key (signs orders via EIP-712)
POLY_API_KEY=...                # Derived once from private key, then stored
POLY_API_SECRET=...             # HMAC secret for API requests
POLY_API_PASSPHRASE=...         # Passphrase for API requests

# OpenRouter
OPENROUTER_API_KEY=...          # Single key for all LLM models

# API-Sports
API_SPORTS_KEY=...              # API-Sports API key

# Turso
TURSO_DATABASE_URL=...          # libSQL connection URL
TURSO_AUTH_TOKEN=...            # Turso auth token
```

**Polymarket auth flow:**

Polymarket uses a two-tier system. Both tiers are needed at runtime:

1. **L1 (Private key / EIP-712)** — signs every order locally. The private key must be available at runtime because order placement requires cryptographic signing.
2. **L2 (API key / HMAC-SHA256)** — used for cancelling orders, checking balances, retrieving order status.

The API credentials (key, secret, passphrase) are **derived once** from the private key using `client.createOrDeriveApiKey()`, then stored as env vars. This avoids a derivation call on every deploy.

**Setup steps:**

1. Create a dedicated Polygon wallet for this project (do not reuse personal wallets)
2. Fund it with USDC on Polygon
3. Derive API credentials locally:
   ```typescript
   const client = new ClobClient("https://clob.polymarket.com", 137, new Wallet(privateKey));
   const creds = await client.createOrDeriveApiKey();
   // Store creds.apiKey, creds.secret, creds.passphrase as env vars
   ```
4. Set all four env vars on the Droplet

---

## External APIs

### Polymarket (Gamma + CLOB)

- **Market discovery**: `GET /sports`, `GET /events?tag_id={id}`
- **Odds/prices**: `GET /price`, `GET /midpoint`, `GET /book` via CLOB
- **Bet placement**: `POST /order` via CLOB (requires wallet auth)
- **Results**: `GET /events?closed=true` via Gamma
- Docs: https://docs.polymarket.com

### API-Sports

- **Fixtures**: upcoming games, schedules
- **Team stats**: season performance, home/away splits
- **Player stats**: per-game, season averages
- **Historical results**: past matchups, head-to-head
- **Standings**: league tables, rankings
- Docs: https://api-sports.io

### OpenRouter

- **Unified LLM gateway**: single API key, 400+ models from 60+ providers
- **SDK**: using `@openrouter/sdk` (official TypeScript SDK) rather than the `openai` compatibility layer
- **Model switching**: just change the `model` string (e.g. `anthropic/claude-sonnet-4`, `openai/gpt-4o`, `google/gemini-2.0-flash-001`)
- **Features**: structured output / JSON mode, tool calling, streaming — all work across providers
- **Pricing**: no per-token markup, 5.5% fee on credit purchases
- **Rate limits**: ~$1 credit balance = 1 req/s, up to 500 RPS max
- Docs: https://openrouter.ai/docs/quickstart

---

## Domain Model

```
Market          — a Polymarket betting market (binary YES/NO outcome)
Event           — a sporting event (game/match) linked to one or more Markets
Sport           — a sport category (football only to start)
Fixture         — an upcoming game with teams, date, venue
Statistics      — strongly-typed stats bundle for a fixture
Prediction      — an LLM's output: direction (YES/NO), confidence, stake
Bet             — a placed bet on Polymarket (market, side, amount, price)
Result          — the outcome of a settled market
Competitor      — an LLM with its own prediction engine committed to the repo
PerformanceLog  — historical record of a Competitor's predictions vs results
```

---

## Directory Structure

```
src/
├── index.ts                    # ✅ Bun.serve entry point (health check at /health)
├── domain/                     # Core domain types and logic (no external deps)
│   ├── models/
│   │   ├── market.ts           # Market, Event, Sport
│   │   ├── fixture.ts          # Fixture, Statistics
│   │   ├── prediction.ts       # Prediction, Bet, Result
│   │   └── competitor.ts       # Competitor, PerformanceLog
│   ├── contracts/
│   │   ├── statistics.ts       # Strongly-typed stats interface (passed to LLMs)
│   │   └── prediction.ts       # Prediction output contract (returned by LLMs)
│   └── services/
│       ├── scoring.ts          # Calculate P&L, accuracy, ROI per competitor
│       └── market-matching.ts  # Match fixtures to Polymarket markets
│
├── infrastructure/             # External integrations
│   ├── polymarket/
│   │   ├── client.ts           # Polymarket API wrapper
│   │   ├── market-discovery.ts # Find and filter sports markets
│   │   ├── betting.ts          # Place and manage bets
│   │   └── settlement.ts       # Track results and settlement
│   ├── sports-data/
│   │   ├── client.ts           # API-Sports wrapper
│   │   ├── fixtures.ts         # Fetch upcoming fixtures
│   │   ├── statistics.ts       # Fetch and normalise stats
│   │   └── mappers.ts          # Map API responses → domain Statistics type
│   └── database/
│       ├── schema.ts           # ✅ Drizzle schema definitions (placeholder)
│       ├── migrate.ts          # ✅ Migration runner (reads Turso creds from env)
│       ├── migrations/         # DB migrations (via drizzle-kit generate)
│       └── repositories/       # Data access layer
│           ├── bets.ts
│           ├── competitors.ts
│           └── results.ts
│
├── engine/                     # Prediction engine orchestration
│   ├── runner.ts               # Import and execute each competitor's prediction engine
│   └── validator.ts            # Validate prediction output against contract
│
├── competitors/                # LLM prediction engines (one per LLM)
│   ├── registry.ts             # Register and discover competitor engines
│   ├── claude/
│   │   └── engine.ts           # Claude's prediction engine (written by Claude)
│   ├── gpt/
│   │   └── engine.ts           # GPT's prediction engine (written by GPT)
│   └── gemini/
│       └── engine.ts           # Gemini's prediction engine (written by Gemini)
│
├── orchestrator/               # Top-level workflow coordination
│   ├── scheduler.ts            # Cron/scheduling: when to fetch, predict, bet
│   ├── pipeline.ts             # Full pipeline: stats → predict → bet → settle
│   └── config.ts               # App configuration
│
└── shared/                     # Cross-cutting concerns
    ├── env.ts                  # ✅ Zod-validated environment variables
    ├── logger.ts               # ✅ Structured JSON logger (info/warn/error/debug)
    ├── errors.ts
    └── types.ts                # Shared utility types

# ✅ = implemented, unmarked = planned

tests/
├── unit/                       # Pure logic tests (domain, scoring, validation)
│   ├── domain/
│   ├── engine/
│   └── competitors/
├── integration/                # Tests with real API calls (mocked or sandboxed)
│   ├── polymarket/
│   ├── sports-data/
│   └── database/
└── e2e/                        # Full pipeline tests
    └── pipeline.test.ts

docs/
├── research.md                 # This document
├── llm-instructions.md         # Instructions given to competing LLMs
└── statistics-schema.md        # Detailed docs for the stats contract

# Root config files (all ✅ implemented):
# biome.json            — Biome linter/formatter config
# drizzle.config.ts     — Drizzle Kit config (Turso dialect)
# tsconfig.json         — Strict mode, path aliases (@domain/*, @shared/*, etc.)
# Dockerfile            — Multi-stage Bun image
# .dockerignore         — Excludes node_modules, .env, docs, tests, .git
# .github/workflows/    — CI, Deploy, Migrations
```

---

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| **Domain** | Models, scoring, market matching | Unit tests — pure functions, no mocks needed |
| **Contracts** | Stats and prediction schemas | Validation tests — ensure Zod schemas accept/reject correctly |
| **Infrastructure** | API clients, mappers, repositories | Integration tests — mock HTTP responses, test DB with Turso local dev mode |
| **Engine** | Runner, output validation | Unit tests — run sample prediction code, assert outputs conform to contract |
| **Competitors** | Each LLM's prediction engine | Unit tests — shared test suite that every engine must pass to confirm contract compliance |
| **Pipeline** | End-to-end flow | E2E tests — full pipeline with mocked external APIs |

---

## Key Design Decisions to Resolve

1. **Which sports to start with?** Football only. No other sports until football is fully working.
2. **How do LLMs write prediction code?** Each LLM receives the `Statistics` interface, the `Prediction` output contract, and an instruction doc. It writes its own prediction engine. The code is tested, reviewed, and committed to the repo.
3. **Iteration process** — after results come in, the LLM receives its own code + the results and can update its engine. Updated code is tested and committed.
4. **Stake sizing** — fixed per bet? Proportional to confidence? Configurable per competitor?
5. **Iteration frequency** — after every game? Daily? Weekly?
6. **Budget management** — max total exposure per LLM? Stop-loss?
7. **Which LLMs to compete?** Claude, GPT-4, Gemini, etc.
8. **Sport:** Football only. No multi-sport support until football works end-to-end.

---

## Pipeline Flow

```
SETUP (one-time per LLM)
1. GENERATE    → Give LLM the instruction doc + Statistics interface + Prediction contract
2. WRITE       → LLM writes its prediction engine (engine.ts)
3. TEST        → Run test suite to confirm engine conforms to contract
4. COMMIT      → Review and commit engine to repo

RUNTIME (automated loop)
5. DISCOVER    → Fetch upcoming Polymarket sports markets
6. MATCH       → Match markets to fixtures via sports data API
7. STATS       → Pull statistics for matched fixtures
8. PREDICT     → Run each competitor's committed engine against the stats
9. BET         → Place bets on Polymarket based on predictions
10. SETTLE     → Monitor markets for resolution
11. SCORE      → Record results, calculate P&L per competitor

ITERATION (periodic)
12. FEEDBACK   → Pass results + competitor's own code back to the LLM
13. UPDATE     → LLM rewrites/improves its engine
14. TEST       → Re-run test suite
15. COMMIT     → Review and commit updated engine
16. GOTO 5
```

---

## Feature Breakdown (MVP Order)

The project is broken into incremental features, each building on the last. Each feature gets its own plan document in `docs/features/<feature>/plan.md`. The ordering follows an MVP approach — get data flowing end-to-end as quickly as possible, then layer on complexity.

### What's already done

- **Feature 0: Project Setup** ✅ — repo scaffold, tooling, CI/CD, Docker, health check server. See `docs/features/project-setup/plan.md`.

### Features to build

#### Feature 1: Domain Types & Contracts

The foundation everything else depends on. Define the core TypeScript types and Zod validation schemas.

- Domain models: `Market`, `Event`, `Sport`, `Fixture`, `Prediction`, `Bet`, `Result`, `Competitor`, `PerformanceLog`
- Contracts: `Statistics` input interface (what LLMs receive), `PredictionOutput` schema (what LLMs return)
- Pure types — no external dependencies, no database, no API calls
- Unit tests for all Zod schemas (valid/invalid inputs)
- **Why first:** every other feature imports these types. Getting the shapes right early prevents cascading changes.

#### Feature 2: Database Schema & Repositories

Persistence layer. Drizzle tables and data access functions.

- Drizzle schema for all domain entities (markets, fixtures, bets, competitors, results, performance logs)
- Repository functions: CRUD operations for each entity
- Generate and apply initial migration to Turso
- Integration tests against a local libSQL instance
- **Depends on:** Feature 1 (domain types define the table shapes)

#### Feature 3: Polymarket Integration (Read-Only)

Connect to Polymarket and discover sports betting markets. Read-only — no betting yet.

- Polymarket client wrapper (authenticated with API key)
- Market discovery: fetch sports markets, filter by sport/tag
- Price/odds fetching: get current prices for markets
- Map Polymarket responses to domain `Market` and `Event` types
- Integration tests with mocked HTTP responses
- **Depends on:** Feature 1 (Market/Event types)

#### Feature 4: Sports Data Integration

Connect to API-Sports and fetch fixture data and statistics.

- API-Sports client wrapper
- Fetch upcoming fixtures for football
- Fetch team/player statistics for a fixture
- Map API responses to domain `Fixture` and `Statistics` types
- Populate the `Statistics` contract with real data shapes
- Integration tests with mocked HTTP responses
- **Depends on:** Feature 1 (Fixture/Statistics types)

#### Feature 5: Market-Fixture Matching

The bridge between Polymarket markets and sports fixtures. Given a list of Polymarket markets and a list of upcoming fixtures, match them together.

- Matching logic: team names, dates, sport type
- Fuzzy matching for team name variations (e.g. "LA Lakers" vs "Los Angeles Lakers")
- Output: paired `Market + Fixture` objects ready for prediction
- Unit tests with known matchups
- **Depends on:** Features 1, 3, 4 (needs Market and Fixture types and real data shapes to design the matcher)

#### Feature 6: Prediction Engine Framework

The runner that executes competitor prediction engines and validates their output.

- `PredictionEngine` interface: `(statistics: Statistics) => PredictionOutput`
- Engine runner: import and execute a competitor's engine, catch errors
- Output validator: validate engine output against the `PredictionOutput` Zod schema
- Competitor registry: discover and register engines from `src/competitors/`
- Unit tests: run a dummy engine, assert output conforms to contract
- **Depends on:** Feature 1 (Statistics and PredictionOutput contracts)

#### Feature 7: First Competitor (Manual Baseline)

A hand-written prediction engine to prove the framework works end-to-end. Not LLM-generated — just a simple heuristic.

- Write a basic `src/competitors/baseline/engine.ts` — e.g. always bet on the home team, or bet based on win rate
- Must conform to the `PredictionEngine` interface
- Register it in the competitor registry
- Unit tests confirming it passes the contract test suite
- **Depends on:** Feature 6 (engine framework)

#### Feature 8: Betting (Polymarket Write)

Place actual bets on Polymarket based on predictions. This is the high-stakes feature.

- Betting module: create and submit orders via CLOB
- Stake sizing: start with a fixed amount per bet (e.g. $1)
- Budget guard: max total exposure, reject bets that exceed it
- Bet recording: save every bet to the database
- Dry-run mode: log what would be bet without actually placing orders
- Integration tests with mocked CLOB responses
- **Depends on:** Features 2, 3, 6 (database, Polymarket client, prediction output)

#### Feature 9: Settlement & Scoring

Track bet outcomes and score competitors.

- Settlement: poll Polymarket for resolved markets, match to placed bets
- Scoring: calculate P&L, accuracy (% correct), ROI per competitor
- Performance log: record each prediction vs actual outcome
- Database updates: mark bets as won/lost, update competitor stats
- Unit tests for scoring logic
- **Depends on:** Features 2, 3, 8 (database, Polymarket client, placed bets)

#### Feature 10: Pipeline Orchestration

Wire everything together into the automated runtime loop.

- Pipeline: discover → match → stats → predict → bet → settle → score
- Scheduler: cron-based timing (e.g. run daily, or before game days)
- Config: which sports, which competitors, stake limits, dry-run toggle
- Logging: structured logs for each pipeline step
- Error handling: individual step failures don't crash the whole pipeline
- **Depends on:** Features 3-9 (all runtime components)

#### Feature 11: LLM Competitor Generation

Use OpenRouter to have LLMs write their own prediction engines.

- OpenRouter client wrapper
- Instruction document: what the LLM receives (Statistics interface, PredictionOutput contract, examples, constraints)
- Generation flow: prompt LLM → receive code → validate → test → commit
- Support multiple models (Claude, GPT-4, Gemini) via model string
- **Depends on:** Features 6, 7 (engine framework, baseline engine as reference)

#### Feature 12: Iteration Loop

Feed results back to LLMs so they can improve their engines.

- Feedback prompt: competitor's current code + its results + overall leaderboard
- Update flow: LLM rewrites engine → test → commit (replace previous version)
- Iteration tracking: version history per competitor
- **Depends on:** Features 9, 11 (scoring data, LLM generation)

### Dependency graph

```
Feature 0 (Setup) ✅
    │
Feature 1 (Domain Types)
    │
    ├── Feature 2 (Database)
    │       │
    ├── Feature 3 (Polymarket Read) ──┐
    │       │                         │
    ├── Feature 4 (Sports Data) ──────┤
    │                                 │
    ├── Feature 5 (Market Matching) ──┘
    │
    ├── Feature 6 (Engine Framework)
    │       │
    │       └── Feature 7 (Baseline Competitor)
    │
    ├── Feature 8 (Betting) ← needs 2, 3, 6
    │       │
    │       └── Feature 9 (Settlement & Scoring) ← needs 2, 3, 8
    │
    ├── Feature 10 (Pipeline) ← needs 3-9
    │
    ├── Feature 11 (LLM Generation) ← needs 6, 7
    │       │
    │       └── Feature 12 (Iteration Loop) ← needs 9, 11
    ```
