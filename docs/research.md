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
| Validation | Zod | Runtime type validation for API responses and LLM-generated code contracts |
| Polymarket SDK | `@polymarket/clob-client` | Official TypeScript client. Note: Bun compatibility to be validated early — community fork `@dschz/polymarket-clob-client` available as fallback |
| Sports Data | API-Sports ecosystem | $19/mo per sport, typed responses, good coverage |
| LLM Integration | OpenRouter via `@openrouter/sdk` | Single API key for all models (Claude, GPT-4, Gemini, etc.). Official TypeScript SDK (pinned version). Model switching is just changing a string |
| Database | Turso (hosted libSQL) + Drizzle ORM | Managed distributed SQLite — free tier covers our usage (5GB, 500M reads/mo). No backup infra needed, no persistent volume concerns |
| LLM Code Lifecycle | Generate → test → commit → run | LLMs write prediction engines that are committed to the repo. No sandboxing — code is reviewed and tested before running |

### Deployment

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Hosting | DigitalOcean Droplet ($4-6/mo) | Simple VM, full control, cheap |
| Database | Turso free tier | Hosted libSQL (SQLite fork). Connects via URL — no local file persistence needed, so ephemeral containers or Droplets both work |
| Estimated monthly cost | ~$25-45 | Droplet ($6) + API-Sports ($19/sport) + Turso (free) |

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
- **OpenAI SDK compatible**: use `openai` package with `baseURL: 'https://openrouter.ai/api/v1'`
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
Sport           — a sport category (NBA, NFL, EPL, etc.)
Fixture         — an upcoming game with teams, date, venue
Statistics      — strongly-typed stats bundle for a fixture
Prediction      — an LLM's output: direction (YES/NO), confidence, stake
Bet             — a placed bet on Polymarket (market, side, amount, price)
Result          — the outcome of a settled market
Competitor      — an LLM with its own prediction engine committed to the repo
PerformanceLog  — historical record of a Competitor's predictions vs results
```

---

## Proposed Directory Structure

```
src/
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
│       ├── schema.ts           # Drizzle schema definitions
│       ├── migrations/         # DB migrations
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
    ├── logger.ts
    ├── errors.ts
    └── types.ts                # Shared utility types

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

1. **Which sports to start with?** NBA is likely best — deep Polymarket liquidity, simple stats structure, lots of games
2. **How do LLMs write prediction code?** Each LLM receives the `Statistics` interface, the `Prediction` output contract, and an instruction doc. It writes its own prediction engine. The code is tested, reviewed, and committed to the repo.
3. **Iteration process** — after results come in, the LLM receives its own code + the results and can update its engine. Updated code is tested and committed.
4. **Stake sizing** — fixed per bet? Proportional to confidence? Configurable per competitor?
5. **Iteration frequency** — after every game? Daily? Weekly?
6. **Budget management** — max total exposure per LLM? Stop-loss?
7. **Which LLMs to compete?** Claude, GPT-4, Gemini, etc.

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
