# LLM Betting Competition — Research & Architecture

## Overview

A platform that pits LLMs against each other in sports prediction markets on Polymarket. Each LLM tunes the weights of a shared prediction engine via structured JSON output, which consumes strongly-typed sports statistics and outputs betting decisions. The system places bets on Polymarket, tracks results, and feeds outcomes back to each LLM so it can evolve its strategy.

The system runs as three independent automated loops: **discovery** (fetch markets and fixtures), **prediction** (run engines and place bets), and **settlement** (resolve bets and calculate P&L). These communicate via the database — discovery writes markets/fixtures, prediction reads them.

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Language | TypeScript (strict mode) | Strong typing for the stats contracts, good Polymarket SDK support |
| Runtime | Bun | Native TS execution (no build step), 2-4x faster than Node, built-in test runner |
| Package Manager | Bun (built-in) | 3-5x faster installs than pnpm, zero additional tooling |
| Testing | Bun test runner | Built-in, Jest-compatible API, extremely fast (~10x Vitest). No config needed |
| Linting/Formatting | Biome | Fast all-in-one linter and formatter. Configured with 2-space indent, 100 char line width, recommended rules, import organising |
| Validation | Zod (v4) | Runtime type validation for API responses and LLM-generated weight configs |
| API Framework | Hono | Zero-dep, TypeScript-first HTTP framework. `app.fetch` plugs directly into `Bun.serve()` |
| Frontend | React 19 + Vite | SPA dashboard for operational visibility. Served as static files in production |
| UI Routing | TanStack Router | File-based, type-safe route params |
| Data Fetching | TanStack Query (React Query) | Caching, auto-refresh (30s), loading/error states |
| Styling | Tailwind CSS v4 + shadcn/ui | Dark theme (zinc palette), New York style components |
| Charts | Recharts | Composable charting for P&L visualisation |
| Polymarket SDK | `@polymarket/clob-client` + `ethers` | Official TypeScript client. `ethers` provides wallet and EIP-712 signing for order placement |
| Sports Data | API-Sports ecosystem | $19/mo per sport, typed responses, good coverage |
| LLM Integration | OpenRouter via `@openrouter/sdk` | Single API key for all models (Claude, GPT-4, Gemini, etc.). Official TypeScript SDK. Structured JSON output for weight generation |
| Database | Turso (hosted libSQL) + Drizzle ORM + Drizzle Kit | Managed distributed SQLite — free tier covers our usage (5GB, 500M reads/mo). Drizzle Kit handles schema generation and migrations |
| Competitor Model | Weight-tuned engines | LLMs don't write code — they tune ~16 JSON weight parameters for a shared prediction algorithm. Weights are validated via Zod and stored in the database |

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
# OpenRouter
OPENROUTER_API_KEY=...          # Single key for all LLM models

# API-Sports
API_SPORTS_KEY=...              # API-Sports API key

# Turso
TURSO_DATABASE_URL=...          # libSQL connection URL
TURSO_AUTH_TOKEN=...            # Turso auth token

# Wallet encryption
WALLET_ENCRYPTION_KEY=...       # AES key for encrypting competitor wallet credentials in the DB
```

**Per-competitor Polymarket wallets:**

Each competitor has its own dedicated Polygon wallet. Wallet credentials (private key, API key, secret, passphrase) are stored **encrypted** in the `competitor_wallets` table using AES encryption with `WALLET_ENCRYPTION_KEY`. This means:

- No Polymarket credentials are stored as environment variables (except the encryption key)
- Each competitor has isolated funds and can be independently funded/managed
- Wallet import is handled via `src/scripts/import-wallets.ts`

**Polymarket auth flow (per wallet):**

Polymarket uses a two-tier system. Both tiers are needed at runtime:

1. **L1 (Private key / EIP-712)** — signs every order locally. The private key must be available at runtime because order placement requires cryptographic signing.
2. **L2 (API key / HMAC-SHA256)** — used for cancelling orders, checking balances, retrieving order status.

The API credentials (key, secret, passphrase) are **derived once** from the private key using `client.createOrDeriveApiKey()`, then encrypted and stored in the database.

---

## External APIs

### Polymarket (Gamma + CLOB) — Two-API Architecture

Polymarket has two separate APIs that serve different purposes:

| API | Base URL | Purpose | Auth |
|-----|----------|---------|------|
| **Gamma** | `https://gamma-api.polymarket.com` | Market discovery, event metadata, sport filtering, tag lookup, odds refresh | None (public) |
| **CLOB** | `https://clob.polymarket.com` | Order placement/cancellation | Wallet + API key |

**Key insight:** The CLOB client SDK (`@polymarket/clob-client`) wraps the CLOB API only. For sports market discovery and odds, we call the Gamma API directly via HTTP — there is no SDK for it.

#### Gamma API — Market Discovery & Odds

**Endpoints we use:**

| Endpoint | Purpose | Key Params |
|----------|---------|------------|
| `GET /sports` | List all supported sports with tag IDs and metadata | `?sport=epl` for specific sport |
| `GET /events` | Fetch events (with nested markets) | `tag_id`, `active`, `closed`, `limit`, `offset`, `order`, `ascending` |
| `GET /markets` | Fetch individual markets (no event grouping) | Same filters as events |
| `GET /markets/{id}` | Fetch a single market by ID | Used for odds refresh before prediction |

**Sport entry shape** (from `GET /sports`):
```json
{
  "id": 2,
  "sport": "epl",
  "image": "https://polymarket-upload.s3.us-east-2.amazonaws.com/...",
  "resolution": "https://www.premierleague.com/",
  "ordering": "home",
  "tags": "1,82,306,100639,100350",
  "series": "10188"
}
```

There are 150+ sport entries covering football (EPL, La Liga, Serie A, Bundesliga, Ligue 1, Champions League, MLS, etc.), basketball, cricket, hockey, esports, and more.

**Football tag discovery:** Each sport entry has a `tags` field (comma-separated tag IDs). To filter for football events, use tag IDs from football sport entries. Tag `82` works well for EPL football events. The full tag list for EPL is `1,82,306,100639,100350`.

**Event filtering:** `GET /events?tag_id=82&active=true&closed=false&order=startDate&ascending=false`

**Football match event shape** (from `GET /events`):
```json
{
  "id": 218306,
  "title": "Tottenham Hotspur FC vs. Crystal Palace FC",
  "slug": "epl-tot-cry-2026-03-05",
  "seriesSlug": "premier-league-2025",
  "eventDate": "2026-03-05",
  "startTime": "2026-03-05T20:00:00Z",
  "score": "",
  "elapsed": "",
  "period": "",
  "active": true,
  "closed": false,
  "tags": [{"id": 82, "label": "Soccer", "slug": "soccer"}],
  "markets": [
    {
      "id": "1400768",
      "question": "Will Tottenham Hotspur FC win on 2026-03-05?",
      "conditionId": "0x...",
      "clobTokenIds": "[\"token_yes\", \"token_no\"]",
      "outcomes": "[\"Yes\", \"No\"]",
      "outcomePrices": "[\"0.405\", \"0.595\"]",
      "gameId": "90091280",
      "sportsMarketType": "moneyline",
      "acceptingOrders": true,
      "active": true,
      "bestBid": 0.39,
      "bestAsk": 0.42,
      "lastTradePrice": 0.41,
      "volume": "12345.67"
    }
  ]
}
```

**Two events per match:** Each football match typically generates two events:
1. **Main event** (e.g., "Team A vs. Team B") — contains 3 moneyline markets (home win, away win, draw). Markets have `gameId` and `sportsMarketType: "moneyline"`.
2. **More Markets event** (e.g., "Team A vs. Team B - More Markets") — contains spreads, totals, BTTS markets. These may not have `gameId`.

**sportsMarketType values for football:**

| Type | Description | Example |
|------|-------------|---------|
| `moneyline` | Win/Lose/Draw (3 binary YES/NO markets per match) | "Will Arsenal FC win?" |
| `spreads` | Point spread / handicap | "Spread: Arsenal FC (-1.5)" |
| `totals` | Over/Under goals | "Team A vs. Team B: O/U 2.5" |
| `both_teams_to_score` | BTTS | "Team A vs. Team B: Both Teams to Score" |

**Pagination:** Offset-based (`limit` + `offset` params). Default limit varies by endpoint.

**Important Gamma API notes:**
- `outcomes` and `outcomePrices` are **JSON-encoded strings**, not arrays. Must parse: `JSON.parse(market.outcomes)`.
- `clobTokenIds` is also a JSON string: `JSON.parse(market.clobTokenIds)`.
- `clobTokenIds[0]` corresponds to `outcomes[0]`, `clobTokenIds[1]` to `outcomes[1]`.
- `gameId` links a market to an external sports data provider's game ID.
- Finished matches have `score` (e.g., "4-0"), `elapsed` (e.g., "90"), `period` (e.g., "FT").

#### CLOB Client SDK — Order Placement

**Read-only instantiation (no auth):**
```typescript
import { ClobClient } from "@polymarket/clob-client";
const client = new ClobClient("https://clob.polymarket.com", 137); // Chain.POLYGON = 137
```

No wallet, no API key — just host and chain ID. This gives access to all read-only methods.

**Key read-only methods:**

| Method | Input | Returns | Use Case |
|--------|-------|---------|----------|
| `getMarket(conditionId)` | Condition ID (hex) | Market data | Look up a specific market by its Gamma conditionId |
| `getOrderBook(tokenId)` | Token ID (numeric string) | `OrderBookSummary` with bids/asks | Real-time order book depth |
| `getMidpoint(tokenId)` | Token ID | Midpoint price | Quick price check |
| `getPrice(tokenId, side)` | Token ID, "BUY"/"SELL" | Price | Best bid or ask |
| `getSpread(tokenId)` | Token ID | Bid-ask spread | Liquidity assessment |
| `getLastTradePrice(tokenId)` | Token ID | Last trade price | Recent activity |
| `getPricesHistory(params)` | Market, time range, fidelity | `{t, p}[]` | Historical price data |
| `getMarkets(next_cursor?)` | Optional cursor | Paginated markets | Browse all CLOB markets |

**OrderBookSummary shape:**
```typescript
{
  market: string;           // Condition ID
  asset_id: string;         // Token ID
  timestamp: string;
  bids: { price: string; size: string }[];
  asks: { price: string; size: string }[];
  min_order_size: string;
  tick_size: string;        // "0.01" for most markets
  neg_risk: boolean;
  last_trade_price: string;
  hash: string;
}
```

**Pagination:** Cursor-based. Initial cursor: `"MA=="` (base64 for 0). End cursor: `"LTE=="`. Response includes `next_cursor`.

**Batch methods:** `getOrderBooks()`, `getMidpoints()`, `getPrices()`, `getSpreads()` accept arrays of `{token_id, side}` for batch lookups.

#### Mapping Between Gamma and CLOB

The bridge between the two APIs:
- Gamma market `conditionId` → CLOB `getMarket(conditionId)`
- Gamma market `clobTokenIds[0]` → CLOB `getOrderBook(tokenId)` for the first outcome
- Gamma market `clobTokenIds[1]` → CLOB `getOrderBook(tokenId)` for the second outcome

**Discovery workflow:**
1. `GET /events?tag_id=X&active=true&closed=false` → fetch match events with nested markets
2. Filter to moneyline markets with matching `seriesSlug`
3. Parse JSON string fields (`outcomes`, `outcomePrices`, `clobTokenIds`)
4. Map to domain `Market` and `Event` types
5. Match to API-Football fixtures by `gameId` or team-name+date fallback
6. Persist to database (bulk upsert)

- Docs: https://docs.polymarket.com

### API-Sports (API-Football v3)

**Base URL:** `https://v3.football.api-sports.io`
**Auth:** Header `x-apisports-key: {API_SPORTS_KEY}`
**Rate limit:** 100 requests/day (free plan), 7500/day ($19/mo plan)
**Season access:** Free plan: 2022-2024 only. Paid plan needed for current season.
**Docs:** https://api-sports.io/documentation/football/v3

#### Endpoints we use

| Endpoint | Purpose | Key Params |
|----------|---------|------------|
| `GET /fixtures` | Upcoming/past fixtures by league, season, date range | `league`, `season`, `from`, `to`, `status`, `date` |
| `GET /fixtures/headtohead` | Head-to-head history between two teams | `h2h` (format: `{teamId1}-{teamId2}`) |
| `GET /standings` | League table with rankings, form, records | `league`, `season` |

**Free plan restrictions:** `next` and `last` params are paid-only. Use `from`/`to` date range instead.

#### Fixture response shape

```json
{
  "fixture": {
    "id": 1208261,
    "referee": "S. Hooper",
    "timezone": "UTC",
    "date": "2025-02-01T12:30:00+00:00",
    "timestamp": 1738413000,
    "venue": { "id": 566, "name": "The City Ground", "city": "Nottingham" },
    "status": { "long": "Match Finished", "short": "FT", "elapsed": 90, "extra": 10 }
  },
  "league": {
    "id": 39, "name": "Premier League", "country": "England",
    "logo": "...", "flag": "...", "season": 2024, "round": "Regular Season - 24"
  },
  "teams": {
    "home": { "id": 65, "name": "Nottingham Forest", "logo": "...", "winner": true },
    "away": { "id": 51, "name": "Brighton", "logo": "...", "winner": false }
  },
  "goals": { "home": 7, "away": 0 },
  "score": {
    "halftime": { "home": 3, "away": 0 },
    "fulltime": { "home": 7, "away": 0 },
    "extratime": { "home": null, "away": null },
    "penalty": { "home": null, "away": null }
  }
}
```

**Status short codes mapping to our domain FixtureStatus:**
- `NS`, `TBD` → `"scheduled"`
- `1H`, `HT`, `2H`, `ET`, `BT`, `P`, `LIVE` → `"in_progress"`
- `FT`, `AET`, `PEN`, `AWD`, `WO` → `"finished"`
- `PST`, `SUSP`, `INT` → `"postponed"`
- `CANC`, `ABD` → `"cancelled"`

#### Standings response shape

```json
{
  "rank": 1,
  "team": { "id": 40, "name": "Liverpool", "logo": "..." },
  "points": 84,
  "goalsDiff": 45,
  "form": "DLDLW",
  "all":  { "played": 38, "win": 25, "draw": 9, "lose": 4, "goals": { "for": 86, "against": 41 } },
  "home": { "played": 19, "win": 14, "draw": 4, "lose": 1, "goals": { "for": 42, "against": 16 } },
  "away": { "played": 19, "win": 11, "draw": 5, "lose": 3, "goals": { "for": 44, "against": 25 } }
}
```

#### H2H response shape

Returns an array of fixtures (same structure as `GET /fixtures`). We aggregate client-side to compute total matches, home wins, away wins, draws, and extract recent matches.

#### Domain type mapping

| API-Sports field | Domain type | Notes |
|-----------------|-------------|-------|
| `fixture.id` | `Fixture.id` | |
| `league` | `Fixture.league` | id, name, country, season |
| `teams.home` | `Fixture.homeTeam` | id, name, logo |
| `teams.away` | `Fixture.awayTeam` | id, name, logo |
| `fixture.date` | `Fixture.date` | ISO string |
| `fixture.venue.name` | `Fixture.venue` | nullable |
| `fixture.status.short` | `Fixture.status` | mapped via status table above |
| standings entry | `TeamStats` | played, wins, draws, losses, goals, form, home/away records |
| h2h fixture list | `H2H` | aggregated: totalMatches, homeWins, awayWins, draws, recentMatches |

### OpenRouter

- **Unified LLM gateway**: single API key, 400+ models from 60+ providers
- **SDK**: using `@openrouter/sdk` (official TypeScript SDK) rather than the `openai` compatibility layer
- **Model switching**: just change the `model` string (e.g. `anthropic/claude-sonnet-4`, `openai/gpt-4o`, `google/gemini-2.0-flash-001`)
- **Structured JSON output**: used for weight generation — LLM returns weights matching a Zod-validated JSON schema
- **Pricing**: no per-token markup, 5.5% fee on credit purchases
- **Rate limits**: ~$1 credit balance = 1 req/s, up to 500 RPS max
- Docs: https://openrouter.ai/docs/quickstart

---

## Domain Model

```
Market          — a Polymarket betting market (binary YES/NO outcome), linked to a Fixture via fixtureId
Event           — a sporting event (game/match) containing one or more Markets (Gamma API grouping)
Fixture         — an upcoming game with teams, date, venue (from API-Football)
Statistics      — strongly-typed stats bundle for a fixture (standings, H2H, market context with fresh odds)
Prediction      — an engine's output: market, side (YES/NO), confidence, stake (bankroll fraction), reasoning (structured JSON)
Reasoning       — structured prediction rationale: { summary, sections[{ label, content, data? }] }
Bet             — a placed bet on Polymarket (market, side, amount, price, shares, status)
Competitor      — a registered competitor with a type ("weight-tuned" or "external"), model, and wallet
CompetitorVersion — a historical version of a competitor's weights/code with raw LLM output and performance snapshot
WalletConfig    — encrypted Polymarket wallet credentials for a competitor
BankrollProvider — estimates available bankroll per competitor: initialBankroll + settledP&L − pendingExposure
```

---

## Directory Structure

```
src/
├── index.ts                           # Bun.serve entry point — wires all components, starts scheduler, serves API + UI
├── api/
│   ├── index.ts                       # createApi() factory — mounts all routes on a Hono app
│   └── routes/
│       ├── dashboard.ts               # GET /api/dashboard — aggregated overview (counts, leaderboard, recent bets)
│       ├── competitors.ts             # GET /api/competitors, GET /api/competitors/:id
│       ├── fixtures.ts                # GET /api/fixtures, GET /api/fixtures/:id
│       ├── markets.ts                 # GET /api/markets
│       ├── bets.ts                    # GET /api/bets
│       └── predictions.ts            # GET /api/predictions
│
├── domain/
│   ├── models/
│   │   ├── market.ts                  # Market, Event domain models
│   │   ├── fixture.ts                 # Fixture domain model
│   │   ├── prediction.ts             # Prediction domain model
│   │   └── competitor.ts             # Competitor domain model
│   ├── contracts/
│   │   ├── engine.ts                  # PredictionEngine interface
│   │   ├── statistics.ts             # Statistics & MarketContext schemas (Zod-validated)
│   │   └── prediction.ts             # PredictionOutput + Reasoning schemas (Zod-validated, structured JSON)
│   ├── types/
│   │   └── competitor.ts             # COMPETITOR_TYPES, WalletConfig, CompetitorConfig
│   └── services/
│       ├── betting.ts                 # placeBet() — constraint checking, dry-run mode, exposure limits
│       ├── bankroll.ts               # BankrollProvider — estimates available bankroll per competitor
│       ├── settlement.ts             # settleBets() — market resolution, profit calculation
│       ├── market-matching.ts        # matchEventsToFixtures() — gameId + team-name+date fallback
│       ├── event-parser.ts           # Event title parsing utilities
│       └── team-names.ts             # Team name normalisation for fuzzy matching
│
├── engine/
│   ├── types.ts                       # PredictionEngine type, RegisteredEngine
│   ├── runner.ts                      # runAllEngines() — executes all registered engines in parallel
│   └── validator.ts                   # validatePredictions() — Zod contract validation
│
├── competitors/
│   ├── registry.ts                    # CompetitorRegistry — in-memory engine registration
│   ├── loader.ts                      # loadCompetitors() — loads from DB, creates engines from weights
│   └── weight-tuned/
│       ├── types.ts                   # WeightConfig schema, DEFAULT_WEIGHTS, WEIGHT_JSON_SCHEMA
│       ├── features.ts               # 7 feature extractors (homeWinRate, formDiff, h2h, etc.)
│       ├── engine.ts                  # createWeightedEngine() — main prediction algorithm
│       ├── validator.ts              # Weight validation via Zod
│       ├── stake-validator.ts        # Post-prediction bankroll/exposure constraints
│       ├── generator.ts              # LLM weight generation via OpenRouter
│       ├── feedback.ts               # Builds feedback prompt for LLM iteration
│       ├── iteration.ts             # Orchestrates weight tuning loop
│       └── sample-statistics.ts      # Test data for weight-tuned engine
│
├── infrastructure/
│   ├── polymarket/
│   │   ├── gamma-client.ts           # REST client for Gamma API (discovery + odds refresh)
│   │   ├── market-discovery.ts       # discoverFootballMarkets() — tag/series/moneyline filtering
│   │   ├── betting-client.ts         # Place orders on Polymarket via CLOB
│   │   ├── betting-client-factory.ts # Creates per-competitor betting clients from wallet config
│   │   ├── pricing-client.ts         # Pricing data access
│   │   ├── mappers.ts                # Gamma API ↔ domain type converters
│   │   └── types.ts                  # Gamma API response types
│   ├── sports-data/
│   │   ├── client.ts                 # API-Football REST client (fixtures, standings, H2H)
│   │   ├── mappers.ts                # API-Football ↔ domain type converters
│   │   └── types.ts                  # API-Football response types
│   ├── openrouter/
│   │   └── client.ts                 # OpenRouter LLM client — structured JSON output for weight generation
│   └── database/
│       ├── schema.ts                 # Drizzle schema (7 tables)
│       ├── client.ts                 # Turso DB connection factory
│       ├── migrate.ts                # Migration runner
│       ├── migrations/               # DB migrations (via drizzle-kit generate)
│       └── repositories/
│           ├── markets.ts            # upsert, bulkUpsert, findByFixtureId, findActive, findAll, etc.
│           ├── fixtures.ts           # upsert, bulkUpsert, findScheduledUpcoming, findAll, etc.
│           ├── predictions.ts        # create, findByFixtureAndCompetitor, findAll, findRecent
│           ├── bets.ts               # create, updateStatus, findByStatus, findByCompetitor, findAll, findRecent
│           ├── competitors.ts        # findByStatus, setStatus, findAll
│           ├── competitor-versions.ts # Store weight/code iterations with performance snapshots
│           └── wallets.ts            # Encrypted wallet CRUD per competitor
│
├── orchestrator/
│   ├── config.ts                      # PipelineConfig type, DEFAULT_CONFIG (leagues, intervals, delays, betting)
│   ├── discovery-pipeline.ts         # Fetch markets + fixtures → match → bulk upsert to DB
│   ├── prediction-pipeline.ts        # Read DB → refresh odds → run engines → save predictions → place bets
│   └── scheduler.ts                  # 3 independent loops with overlap prevention + configurable start delays
│
├── scripts/
│   ├── iterate.ts                     # LLM iteration loop (generate/update weights)
│   ├── add-competitor.ts             # CLI to register a new competitor in the DB
│   ├── import-wallets.ts             # Decrypt and re-import wallet files into DB
│   ├── manage-wallets.ts             # Wallet management utilities
│   ├── test-pipeline.ts              # Manual pipeline testing
│   └── discover-tags.ts             # Discover Polymarket sport tag IDs
│
└── shared/
    ├── env.ts                         # Zod-validated environment variables
    ├── logger.ts                      # Structured JSON logger (info/warn/error/debug)
    ├── crypto.ts                      # AES encryption/decryption for wallet credentials
    └── api-types.ts                   # Shared DTO types for API responses (imported by both backend and UI)

ui/                                    # React SPA dashboard (Vite + TanStack Router)
├── src/
│   ├── main.tsx                       # Entry: QueryClientProvider + SidebarProvider + RouterProvider
│   ├── router.tsx                     # TanStack Router route tree (7 routes)
│   ├── lib/
│   │   ├── api.ts                     # Typed fetch functions + TanStack Query hooks (30s auto-refresh)
│   │   ├── format.ts                  # Date, currency, percentage formatters
│   │   └── utils.ts                   # cn() helper (Tailwind class merging)
│   ├── routes/
│   │   ├── index.tsx                  # Dashboard — stat cards, P&L chart, leaderboard, recent bets
│   │   ├── competitors/
│   │   │   ├── index.tsx              # Competitors list with performance stats
│   │   │   └── $id.tsx                # Competitor detail — versions, bets, predictions tabs
│   │   ├── fixtures/
│   │   │   ├── index.tsx              # Fixtures list with date sorting and status tabs
│   │   │   └── $id.tsx                # Fixture detail — markets table, predictions with reasoning modal
│   │   ├── markets/
│   │   │   └── index.tsx              # Markets list with active/closed filters, sortable columns
│   │   └── bets/
│   │       └── index.tsx              # Bets list with status tabs and competitor filter
│   └── components/
│       ├── layout/
│       │   ├── sidebar.tsx            # Collapsible navigation sidebar (w-64 ↔ w-16)
│       │   ├── sidebar-context.tsx    # Sidebar collapse state (React Context + localStorage)
│       │   └── page-shell.tsx         # Page wrapper (title + subtitle + content)
│       ├── dashboard/
│       │   ├── stats-cards.tsx        # KPI cards (competitors, fixtures, markets, bets)
│       │   ├── leaderboard.tsx        # Competitor ranking table sorted by P&L
│       │   ├── recent-activity.tsx    # Last 10 bets feed
│       │   └── pnl-chart.tsx          # Cumulative P&L area chart (Recharts)
│       ├── shared/
│       │   ├── reasoning-modal.tsx    # Click-to-open modal for structured reasoning sections
│       │   ├── model-logo.tsx         # Brand icons for LLM models (Claude, GPT, Gemini, etc.)
│       │   ├── status-badge.tsx       # Colour-coded status indicators
│       │   ├── stat-card.tsx          # Single metric card
│       │   ├── money.tsx              # Currency formatting (green/red)
│       │   ├── loading-skeleton.tsx   # Skeleton loading states
│       │   └── empty-state.tsx        # Empty data placeholder
│       └── ui/                        # shadcn/ui primitives (table, tabs, dialog, button, etc.)
└── vite.config.ts                     # Vite config with Tailwind plugin, /api proxy, path aliases

tests/
└── unit/
    ├── health.test.ts
    ├── shared/
    │   └── crypto.test.ts
    ├── api/
    │   ├── dashboard.test.ts          # Dashboard aggregation endpoint
    │   ├── competitors.test.ts        # Competitors list + detail endpoints
    │   ├── fixtures.test.ts           # Fixtures list + detail endpoints
    │   ├── markets.test.ts            # Markets list endpoint
    │   ├── bets.test.ts               # Bets list endpoint
    │   └── predictions.test.ts        # Predictions list endpoint
    ├── domain/
    │   ├── contracts/
    │   │   ├── prediction.test.ts     # Prediction + Reasoning schema validation
    │   │   └── statistics.test.ts
    │   └── services/
    │       ├── betting.test.ts
    │       ├── bankroll.test.ts       # BankrollProvider unit tests
    │       ├── settlement.test.ts
    │       ├── matching.test.ts
    │       ├── event-parser.test.ts
    │       └── team-names.test.ts
    ├── engine/
    │   ├── runner.test.ts
    │   └── validator.test.ts
    ├── competitors/
    │   ├── registry.test.ts
    │   ├── loader.test.ts
    │   └── weight-tuned/
    │       ├── engine.test.ts
    │       ├── features.test.ts
    │       ├── feedback.test.ts       # Feedback prompt generation
    │       ├── generator.test.ts      # LLM weight generation
    │       ├── iteration.test.ts      # Iteration loop orchestration
    │       └── validator.test.ts
    ├── scripts/
    │   └── add-competitor.test.ts     # CLI competitor registration
    ├── infrastructure/
    │   ├── database/repositories/
    │   │   ├── bets.test.ts
    │   │   ├── competitors.test.ts
    │   │   ├── fixtures.test.ts
    │   │   ├── markets.test.ts
    │   │   └── predictions.test.ts
    │   ├── polymarket/
    │   │   ├── gamma-client.test.ts
    │   │   ├── mappers.test.ts
    │   │   ├── market-discovery.test.ts
    │   │   └── betting-client.test.ts
    │   └── sports-data/
    │       ├── client.test.ts
    │       └── mappers.test.ts
    └── orchestrator/
        ├── pipeline.test.ts           # Discovery + prediction pipeline tests
        └── scheduler.test.ts          # Scheduler tests (delays, overlap, stop)

docs/
├── research.md                        # This document
├── llm-weight-instructions.md         # System prompt / instructions for LLM weight tuning
└── features/                          # Feature plan documents (historical)
    ├── project-setup/plan.md
    ├── domain-types/plan.md
    ├── database-schema/plan.md
    ├── polymarket-read/plan.md
    ├── sports-data/plan.md
    ├── betting/plan.md
    ├── settlement/plan.md
    ├── pipeline/plan.md
    ├── llm-generation/plan.md
    ├── iteration-loop/plan.md
    ├── competitor-management/plan.md
    ├── fix-market-discovery-filtering/plan.md
    ├── per-competitor-wallets/plan.md
    ├── single-bet-per-fixture/plan.md
    ├── weight-tuned-engine/plan.md
    ├── pipeline-split/plan.md
    ├── weight-generation-cleanup/review.md
    ├── bankroll-relative-staking/plan.md
    ├── bankroll-relative-staking/review.md
    └── structured-reasoning/plan.md

# Root config files:
# biome.json            — Biome linter/formatter config
# drizzle.config.ts     — Drizzle Kit config (Turso dialect)
# tsconfig.json         — Strict mode, path aliases (@domain/*, @shared/*, etc.)
# Dockerfile            — Multi-stage Bun image
# .dockerignore         — Excludes node_modules, .env, docs, tests, .git
# .github/workflows/    — CI, Deploy, Migrations
```

---

## Database Schema

**Drizzle ORM with SQLite/libSQL (Turso). 7 tables.**

SQLite has limited types — everything is `text`, `integer`, `real`, or `blob`. Drizzle provides modes for richer semantics:

- `integer("col", { mode: "timestamp" })` — stores seconds since epoch, returns `Date`
- `integer("col", { mode: "boolean" })` — stores 0/1, returns `boolean`
- `text("col", { mode: "json" })` — stores JSON string, returns parsed object. Used with `.$type<T>()` for typed access
- `text("col", { enum: ["a", "b"] })` — text with TypeScript enum constraint
- `real("col")` — floating point (for prices, amounts)

### Tables

| Table | Primary Key | Key Columns | Notes |
|-------|-------------|-------------|-------|
| `markets` | `id` (text) | conditionId, gameId, sportsMarketType, fixtureId (FK) | Polymarket markets. Tuple fields (outcomes, tokenIds, outcomePrices) stored as JSON text columns. `fixtureId` nullable — set when matched to a fixture |
| `fixtures` | `id` (integer) | leagueId, homeTeamId, awayTeamId, date, status | API-Sports fixtures. League and team data denormalised. Team logos stored |
| `competitors` | `id` (text) | name, model, type, status, config | LLM competitors. `type` is "weight-tuned". `status` is "active", "disabled", "pending", or "error" |
| `competitor_versions` | auto-increment int | competitorId (FK), version, code, rawLlmOutput, model, performanceSnapshot | Historical weight/code versions. `code` stores serialised JSON weights. `rawLlmOutput` stores the raw LLM API response for debugging. `performanceSnapshot` (JSON) stores wins/losses/ROI at time of version |
| `competitor_wallets` | auto-increment int | competitorId (FK, unique), walletAddress | Encrypted Polymarket credentials (private key, API key, secret, passphrase). One wallet per competitor |
| `predictions` | auto-increment int | marketId (FK), fixtureId (FK), competitorId (FK), side, confidence, stake, reasoning (JSON) | Engine outputs. `reasoning` is structured JSON: `{ summary, sections[{ label, content, data? }] }`. Saved unconditionally (not gated on bet success) |
| `bets` | `id` (text) | orderId, marketId (FK), fixtureId (FK), competitorId (FK), tokenId, side, amount, price, shares, status | Placed Polymarket orders. Status: pending → filled → settled_won/settled_lost. `profit` set on settlement |

**Denormalisation decisions:**
- `fixtures` table stores league name/country/season and team names directly rather than in separate `leagues` and `teams` tables. These are reference data from API-Sports that rarely changes and is always read together with the fixture.
- `markets` table stores outcomes/tokenIds/outcomePrices as JSON text columns since they're always read as a pair and never queried individually.
- Performance stats are computed on-the-fly from the `bets` table, or stored as snapshots in `competitor_versions.performanceSnapshot`.

**Repository pattern:** each table gets a repository file with typed CRUD functions. Repositories take a `db` instance (dependency injection) so they're testable. Key methods include `bulkUpsert` for efficient batch writes during discovery, and `findAll`/`findRecent` for API-layer queries.

---

## Weight-Tuned Prediction Engine

Instead of having each LLM write arbitrary prediction code, all competitors use a **shared prediction algorithm** parameterised by ~16 JSON weight values. LLMs compete by tuning these weights.

### Algorithm

1. **Feature extraction** — 7 features, all normalised to [0, 1]:
   - `homeWinRate` — home team's win rate at home
   - `awayLossRate` — away team's loss rate on the road
   - `formDiff` — recent form difference (W/D/L averaging)
   - `h2h` — head-to-head home win rate
   - `goalDiff` — goal difference per game
   - `pointsPerGame` — points per game difference
   - `defensiveStrength` — away team concedes minus home team concedes

2. **Weighted average** — compute `homeStrength = Σ(weight_i × feature_i)` normalised to [0, 1]

3. **Probability model** — Gaussian draw curve with tuneable `drawPeak` and `drawWidth` parameters. Remaining probability split by `homeStrength` ratio into home/away probabilities

4. **Market classification** — each market's question text is classified as home-win, away-win, or draw

5. **Value edge** — for each market, compute edge on both YES and NO sides vs. current Polymarket odds. Select the best-edge market per fixture

6. **Stake sizing** — engines output a **bankroll fraction** (0–1), not an absolute dollar amount. The prediction pipeline resolves this to an absolute stake via the BankrollProvider. Confidence-modulated, bounded by `StakeConfig.maxBetPct` and `StakeConfig.minBetPct`

7. **Output** — at most **1 prediction per fixture** (the best-edge market). Includes structured reasoning with probability breakdown, signal values, and edge analysis

### Weight Tuning via LLM

- LLM receives: current weights (JSON table), feature descriptions, algorithm explanation, performance feedback
- LLM outputs: new weights as **structured JSON** matching `WEIGHT_JSON_SCHEMA`
- Weights validated via Zod before DB storage
- Version history tracked in `competitor_versions` table
- See `docs/llm-weight-instructions.md` for the full LLM prompt

---

## Pipeline Architecture

The system runs three independent loops that communicate via the database:

### Discovery Pipeline (every 30 minutes)

```
1. DISCOVER    → Fetch active Polymarket events for configured leagues (Gamma API)
                 Filter to moneyline markets, deduplicate by tag
2. FETCH       → Fetch upcoming fixtures from API-Football (configured look-ahead window)
3. MATCH       → Match events to fixtures (gameId first, team-name+date fallback)
4. PERSIST     → Bulk upsert ALL fixtures to DB
                 Bulk upsert ALL markets to DB (matched ones get fixtureId, unmatched get null)
```

### Prediction Pipeline (every 6 hours, delayed 30s after startup)

```
1. READ        → Find scheduled upcoming fixtures from DB
2. FOR EACH FIXTURE:
   a. MARKETS  → Find linked markets from DB (by fixtureId)
   b. REFRESH  → Refresh odds from Gamma API → update market prices in DB
   c. STATS    → Fetch standings + H2H from API-Football
   d. BUILD    → Assemble Statistics object with fresh odds
   e. PREDICT  → Run all registered engines against the statistics
   f. SAVE     → Save predictions to DB (unconditional — not gated on bet success)
   g. BANKROLL → Fetch competitor's current bankroll (initial + settled P&L − pending exposure)
   h. RESOLVE  → Convert engine's stake fraction (0–1) to absolute dollar amount
   i. BET      → Attempt bet placement (may be skipped: dry-run, duplicate, exposure limit)
```

### Settlement Loop (every 2 hours)

```
1. FIND        → Query pending/filled bets from DB
2. CHECK       → For each bet, fetch market state from Gamma API
3. RESOLVE     → If market is closed: determine winning outcome (price ≥ 0.99)
4. SETTLE      → Calculate profit/loss, update bet status in DB
```

### Scheduler

The scheduler manages all three loops with:
- **Overlap prevention** — if a run is still in progress, the next interval tick is skipped
- **Configurable start delays** — e.g. prediction pipeline delayed 30s so discovery can populate data first
- **Graceful shutdown** — `stop()` clears all 6 timers (3 interval + 3 delay)

### Default Configuration

```typescript
{
  leagues: [{ id: 39, name: "Premier League", polymarketTagIds: [82], polymarketSeriesSlug: "premier-league" }],
  season: 2025,
  fixtureLookAheadDays: 7,
  discoveryIntervalMs: 30 * 60 * 1000,      // 30 minutes
  predictionIntervalMs: 6 * 60 * 60 * 1000,  // 6 hours
  settlementIntervalMs: 2 * 60 * 60 * 1000,  // 2 hours
  predictionDelayMs: 30_000,                  // 30s delay to let discovery run first
  betting: {
    maxStakePerBet: 10,                       // Absolute dollar cap per bet
    maxBetPctOfBankroll: 0.1,                 // No single bet > 10% of bankroll
    maxTotalExposure: 100,                    // Total pending exposure limit
    initialBankroll: 100,                     // Starting bankroll per competitor
    minBetAmount: 0.01,                       // Minimum bet size
    dryRun: false,                            // Live betting (was true during development)
  },
}
```

---

## Dashboard & API

A read-only web dashboard provides operational visibility into the system. The API and UI are served from the same `Bun.serve()` instance.

```
Browser ──→ Bun.serve() ──→ Hono router
                              ├── /api/*     → JSON responses (repository queries)
                              ├── /health    → { status: "ok" }
                              └── /*         → ui/dist/index.html (SPA fallback)
```

### API Endpoints

All endpoints are `GET` (read-only). The API factory (`createApi`) receives all repository instances via dependency injection.

| Endpoint | Purpose | Filters |
|----------|---------|---------|
| `GET /api/dashboard` | Aggregated overview: counts, leaderboard (sorted by P&L), last 10 bets | — |
| `GET /api/competitors` | Competitor list with performance stats | `?status=active\|disabled\|pending\|error` |
| `GET /api/competitors/:id` | Detail with version history, recent bets, recent predictions | — |
| `GET /api/fixtures` | Fixture list with market counts | `?status=scheduled\|in_progress\|finished\|postponed\|cancelled` |
| `GET /api/fixtures/:id` | Detail with linked markets and predictions | — |
| `GET /api/markets` | Market list | `?active=true\|false&closed=true\|false` |
| `GET /api/bets` | Bet list with enriched competitor/market names | `?status=...&competitorId=...` |
| `GET /api/predictions` | Prediction list with enriched names | `?competitorId=...` |

**Security:** Wallet credentials, raw LLM output, and weight config code are never exposed via the API. Only `hasWallet: boolean` and `walletAddress: string` are surfaced.

**Shared types:** API response shapes (`DashboardResponse`, `CompetitorSummary`, `BetSummary`, etc.) are defined in `src/shared/api-types.ts` and imported by both the API routes and the UI.

### UI Pages

| Page | Route | Key Features |
|------|-------|--------------|
| Dashboard | `/` | 4 stat cards, cumulative P&L area chart (Recharts), leaderboard table, recent bets feed. Auto-refreshes every 30s |
| Competitors | `/competitors` | Table with model logo, status badge, W/L, P&L, ROI, accuracy. Links to detail |
| Competitor Detail | `/competitors/:id` | Header with stats, tabbed: Bets / Predictions / Versions |
| Fixtures | `/fixtures` | Date-sorted table with status filter tabs, market count per fixture |
| Fixture Detail | `/fixtures/:id` | Markets table (prices, liquidity), predictions table with reasoning modal |
| Markets | `/markets` | Active/closed filter, sortable by liquidity/volume |
| Bets | `/bets` | Status tabs (pending, filled, settled), competitor filter |

**Theme:** Full dark mode — zinc-950 sidebar, zinc-900 content, emerald-500 for profit, red-500 for loss. Status badges colour-coded (blue/amber/green/red/grey).

**Dev workflow:**
```bash
bun run dev:api    # Backend with --watch
cd ui && bun run dev  # Vite dev server with /api proxy to localhost:3000
```

**Production:** `bun run build:ui` outputs to `ui/dist/`, served via Hono's `serveStatic` middleware with SPA fallback.

---

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| **Domain contracts** | Statistics and prediction Zod schemas (including structured reasoning) | Validation tests — ensure schemas accept/reject correctly |
| **Domain services** | Betting, bankroll, settlement, market matching, event parsing, team names | Unit tests — pure functions with mocked dependencies |
| **Engine** | Runner (parallel execution), output validation | Unit tests — run sample engines, assert contract compliance |
| **Competitors** | Weight-tuned engine, feature extraction, weight validation, feedback, generator, iteration, registry, loader | Unit tests — known inputs/outputs, edge cases |
| **API routes** | Dashboard, competitors, fixtures, markets, bets, predictions endpoints | Unit tests — Hono `app.request()` with mock repo objects, no real DB |
| **Infrastructure** | API clients, mappers, repositories | Unit tests — mock HTTP responses, in-memory SQLite DB, verify mapping logic |
| **Orchestrator** | Discovery pipeline, prediction pipeline, scheduler | Unit tests — mock all dependencies, verify sequencing and error handling |

---

## Key Design Decisions (Resolved)

1. **Sport:** Football only (Premier League). No multi-sport support until football works end-to-end.
2. **How LLMs compete:** LLMs don't write arbitrary code. They tune JSON weights for a shared prediction algorithm. This is safer, faster to iterate, and easier to validate than arbitrary code generation.
3. **Iteration process:** LLM receives current weights + performance feedback via structured prompt. Outputs new weights as JSON. Raw LLM output stored in `competitor_versions.rawLlmOutput` for debugging. Orchestrated via `src/scripts/iterate.ts`.
4. **Stake sizing:** Engines output bankroll fractions (0–1). Pipeline resolves to absolute amounts via BankrollProvider (`initialBankroll + settledP&L − pendingExposure`). Bounded by `maxStakePerBet` (default $10), `maxBetPctOfBankroll` (10%), and `maxTotalExposure` (default $100). One prediction per fixture per competitor.
5. **Budget management:** Per-competitor wallets with encrypted credentials. `maxTotalExposure` prevents runaway betting. Each competitor has an independent bankroll tracked via settled bet history.
6. **Pipeline architecture:** Two independent pipelines (discovery + prediction) communicating via the database, plus a separate settlement loop. Predictions saved unconditionally. Odds refreshed from Gamma before engine execution.
7. **Competitor wallets:** Per-competitor encrypted wallets stored in DB (not env vars). Each competitor has its own funded Polygon wallet.
8. **Structured reasoning:** Predictions store reasoning as structured JSON (`{ summary, sections[] }`) rather than free text. Each section has a label, content, and optional key-value data. Validated via Zod schema. Displayed in the UI via a click-to-open modal with data grids.
9. **Dashboard:** Read-only web UI (React SPA) served alongside the API via Hono. Provides operational visibility into competitors, fixtures, markets, bets, and predictions. Auto-refreshes every 30 seconds. Dark theme with zinc palette. No authentication — designed for internal monitoring only.
