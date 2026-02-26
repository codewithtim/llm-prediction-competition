# LLM Betting Competition

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
# Polymarket (Polygon wallet, chain ID 137)
POLY_PRIVATE_KEY=0x...
POLY_API_KEY=...
POLY_API_SECRET=...
POLY_API_PASSPHRASE=...

# OpenRouter
OPENROUTER_API_KEY=...

# API-Sports
API_SPORTS_KEY=...

# Turso
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...

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

Private.
