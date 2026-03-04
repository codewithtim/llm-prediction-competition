# LLM Betting Competition

> **Disclaimer:** This is a vibe-coded experiment built with heavy AI assistance (Claude Code). It is a personal learning project and does not represent production-quality work or a reflection of the author's professional coding standards. No guarantees are made about correctness, security, or suitability for any purpose. Use at your own risk.

A platform that pits LLMs against each other in sports prediction markets on [Polymarket](https://polymarket.com). Each LLM writes and iterates on its own prediction engine, consuming strongly-typed sports statistics and outputting betting decisions. The system places bets, tracks results, and feeds outcomes back so each LLM can evolve its strategy.

## How It Works

1. **Each LLM gets the same inputs** — a typed statistics interface and a prediction output contract
2. **Each LLM writes its own prediction engine** — committed to the repo under `src/competitors/<model>/`
3. **The system runs all engines** against upcoming Polymarket sports markets
4. **Bets are placed** on Polymarket using each engine's predictions
5. **Results are tracked** — P&L, accuracy, and ROI per competitor
6. **LLMs iterate** — they receive their results and can rewrite their engines

## Tech Stack

- **Runtime:** [Bun](https://bun.sh) (TypeScript, no build step)
- **Database:** [Turso](https://turso.tech) (hosted libSQL) + [Drizzle ORM](https://orm.drizzle.team)
- **Betting:** [Polymarket CLOB client](https://docs.polymarket.com) + ethers (EIP-712 signing)
- **Sports Data:** [API-Sports](https://api-sports.io)
- **LLM Gateway:** [OpenRouter](https://openrouter.ai) (`@openrouter/sdk`)
- **Validation:** Zod v4
- **Linting:** Biome

## Prerequisites

- [Bun](https://bun.sh) (latest)
- A Turso database ([free tier](https://turso.tech/pricing))
- API keys for: Polymarket, OpenRouter, API-Sports

## Getting Started

```bash
# Install dependencies
bun install

# Copy env template and fill in your keys
cp .env.example .env

# Run database migrations
bun run db:migrate

# Start the dev server (with hot reload)
bun run dev
```

The server starts at `http://localhost:3000` with a health check at `/health`.

## Environment Variables

```
# Database — local SQLite file or remote Turso
TURSO_DATABASE_URL=file:data/local.db   # local (no auth token needed)
# TURSO_DATABASE_URL=libsql://...      # remote Turso
# TURSO_AUTH_TOKEN=...                  # required for remote Turso only

# Polymarket (Polygon wallet, chain ID 137)
POLY_PRIVATE_KEY=0x...
POLY_API_KEY=...
POLY_API_SECRET=...
POLY_API_PASSPHRASE=...

# OpenRouter
OPENROUTER_API_KEY=...

# API-Sports
API_SPORTS_KEY=...

# Optional
PORT=3000
```

## Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start dev server with hot reload |
| `bun run start` | Start production server |
| `bun test` | Run tests |
| `bun run typecheck` | Type-check with `tsc --noEmit` |
| `bun run lint` | Lint and format check with Biome |
| `bun run lint:fix` | Auto-fix lint and formatting issues |
| `bun run db:generate` | Generate Drizzle migrations from schema |
| `bun run db:migrate` | Run pending database migrations |
| `bun run db:studio` | Open Drizzle Studio (visual DB browser) |
| `bun run test:pipeline` | Run end-to-end prediction pipeline test |
| `bun run iterate` | Iterate codegen competitors (generate improved engines) |

## Local Setup Guide

Step-by-step instructions to run and test the full prediction pipeline locally.

### 1. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. Install dependencies

```bash
bun install
```

### 3. Get your API keys

You need accounts on these services (all have free tiers):

| Service | Key(s) needed | Free tier | Sign up |
|---------|--------------|-----------|---------|
| **API-Sports** | `API_SPORTS_KEY` | 100 req/day, seasons 2022-2024 | [api-sports.io](https://api-sports.io) |
| **OpenRouter** | `OPENROUTER_API_KEY` | Pay-per-use (some free models) | [openrouter.ai](https://openrouter.ai) |
| **Polymarket** | `POLY_PRIVATE_KEY`, `POLY_API_KEY`, `POLY_API_SECRET`, `POLY_API_PASSPHRASE` | Free (needs Polygon wallet) | [docs.polymarket.com](https://docs.polymarket.com) |

Polymarket keys are **optional for local development**. Without them the server runs in dry-run mode — predictions are generated and logged but no real bets are placed.

No database service signup is needed — local development uses a SQLite file.

### 4. Configure environment

```bash
cp .env.example .env
```

The default `.env.example` uses a local SQLite database and leaves Polymarket credentials empty (dry-run mode). Fill in only the API keys you need:

```
# Database — local SQLite (no signup needed)
TURSO_DATABASE_URL=file:data/local.db

# Required for the full server
API_SPORTS_KEY=<your key>
OPENROUTER_API_KEY=<your key>

# Optional — leave empty for dry-run mode (no real bets placed)
POLY_PRIVATE_KEY=
POLY_API_KEY=
POLY_API_SECRET=
POLY_API_PASSPHRASE=
```

For production or shared environments, use a remote Turso database instead:

```
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=<your token>
```

### 5. Run database migrations

```bash
bun run db:migrate
```

This creates `data/local.db` with all tables: `markets`, `fixtures`, `competitors`, `competitor_versions`, `predictions`, `bets`.

If you've modified the schema and need to generate a new migration:

```bash
bun run db:generate
bun run db:migrate
```

You can inspect the database visually with:

```bash
bun run db:studio
```

### 6. Run the unit tests (no API keys needed)

```bash
bun test
```

All 313 tests run against mocked data — no external services required.

### 7. Test the prediction pipeline (needs API_SPORTS_KEY only)

```bash
bun run test:pipeline
```

This wires together the full flow without the database or betting:

1. Discovers football markets on Polymarket (public Gamma API, no key needed)
2. Fetches fixtures from API-Football across 5 European leagues
3. Matches Polymarket markets to fixtures by team name and date
4. Gathers statistics (standings + head-to-head) for the best match
5. Runs the baseline heuristic engine
6. Prints the prediction: side, confidence, stake, reasoning, edge vs market price

Falls back to a synthetic market if no Polymarket matches exist.

### 8. Run the full server (all keys needed)

```bash
# Development (hot reload)
bun run dev

# Production
bun run start
```

The server starts at `http://localhost:3000`:
- `GET /health` — health check

On startup, the scheduler begins two loops:
- **Prediction loop** (every 6 hours) — discovers markets, fetches fixtures, runs all engines, places bets
- **Settlement loop** (every 2 hours) — resolves settled markets, calculates P&L

Betting is in **dry-run mode by default** (`dryRun: true` in `src/orchestrator/config.ts`). No real money is placed unless you change this to `false`. If Polymarket credentials aren't set, the server logs a notice and uses a stub betting client — the full prediction pipeline still runs, you just can't place real bets.

Four competitors are registered at startup:
- `baseline` — hand-written heuristic engine (home advantage + form + H2H)
- `claude-runtime` — Claude Sonnet via OpenRouter (calls LLM at prediction time)
- `gpt4o-runtime` — GPT-4o via OpenRouter
- `gemini-runtime` — Gemini Flash via OpenRouter

### 9. Generate and iterate LLM codegen competitors

These are LLM-written TypeScript engines that get committed to the repo:

```bash
# Iterate all codegen competitors (gathers performance, generates improved code)
bun run iterate

# Iterate a specific competitor
bun run iterate --competitor <id>
```

The iteration loop:
1. Reads the competitor's current engine code from disk
2. Gathers performance stats (wins, losses, accuracy, ROI, P&L)
3. Builds a feedback prompt with code + stats + leaderboard
4. Calls the LLM to generate improved engine code
5. Validates the new code (imports, runs against sample data, Zod checks)
6. Saves as a versioned file (`engine_v1.ts`, `engine_v2.ts`, etc.)
7. Updates the database and re-registers in the engine registry

### Running with Docker

```bash
# Build the image
docker build -t llm-betting .

# Create the data directory
mkdir -p data

# Run migrations (creates the SQLite database on your host)
bun run db:migrate

# Run the container with the data directory mounted
docker run --env-file .env -p 3000:3000 -v $(pwd)/data:/app/data llm-betting
```

The `-v $(pwd)/data:/app/data` mount means `data/local.db` lives on your host filesystem. You can open it with any SQLite GUI:

- **TablePlus** — New Connection > SQLite > Browse to `data/local.db`
- **Drizzle Studio** — `bun run db:studio` (web-based, runs outside Docker)
- **DB Browser for SQLite** — File > Open Database > `data/local.db`

The database file persists across container restarts since it's on your host, not inside the container.

### What each API key unlocks

Not all keys are needed for every task:

| Task | Database | API-Sports | OpenRouter | Polymarket |
|------|----------|------------|------------|------------|
| `bun test` | - | - | - | - |
| `bun run test:pipeline` | - | Required | - | - |
| `bun run dev` (full server) | Required | Required | Required | Optional (dry-run without) |
| `bun run iterate` | Required | - | Required | - |
| `bun run db:studio` | Required | - | - | - |

### Current limitations

- **Free API-Football tier** only covers seasons 2022-2024, so the test pipeline uses historical fixtures from March 2025. Upgrade to the paid plan ($19/mo) for current season data.
- **Polymarket tag filtering** is broad and may pull in esports alongside football.

## Project Structure

```
src/
├── index.ts                 # Bun.serve entry point
├── domain/                  # Core types and business logic
├── infrastructure/          # External integrations (Polymarket, API-Sports, DB)
├── engine/                  # Prediction engine orchestration
├── competitors/             # LLM prediction engines (one per model)
├── orchestrator/            # Pipeline coordination and scheduling
└── shared/                  # Env config, logger, utilities
```

See [docs/research.md](docs/research.md) for the full architecture and design decisions.

## Deployment

Deployed via Docker to a DigitalOcean Droplet. The deploy workflow builds a container image, pushes to GitHub Container Registry, and pulls it on the Droplet.

```bash
# Build locally
docker build -t llm-betting .

# Run locally
docker run --env-file .env -p 3000:3000 llm-betting
```

CI runs on every push/PR to `main` (lint, typecheck, test). Deploy and migration workflows are triggered manually via GitHub Actions.

## License

[MIT](LICENSE)
