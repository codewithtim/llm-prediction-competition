# Plan: Initial Project Setup

Scope: repository scaffolding, tooling, directory structure, and a minimal running server. No business logic.

---

## 1. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

This installs Bun globally. After installation, restart the shell or source the profile so `bun` is on PATH.

---

## 2. Initialise Bun project

```bash
bun init
```

This creates `package.json`, `tsconfig.json`, and `index.ts`.

### tsconfig.json

Strict mode, path aliases for clean imports:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "paths": {
      "@domain/*": ["./src/domain/*"],
      "@infrastructure/*": ["./src/infrastructure/*"],
      "@engine/*": ["./src/engine/*"],
      "@competitors/*": ["./src/competitors/*"],
      "@orchestrator/*": ["./src/orchestrator/*"],
      "@shared/*": ["./src/shared/*"]
    }
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

### package.json scripts

```json
{
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "lint:fix": "biome check --fix .",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "bun run src/infrastructure/database/migrate.ts",
    "db:studio": "drizzle-kit studio"
  }
}
```

---

## 3. Install dependencies

### Runtime

```bash
bun add zod drizzle-orm @libsql/client @openrouter/sdk @polymarket/clob-client ethers
```

| Package | Purpose |
|---------|---------|
| `zod` | Runtime validation for contracts |
| `drizzle-orm` | ORM for Turso/libSQL |
| `@libsql/client` | Turso database driver |
| `@openrouter/sdk` | OpenRouter TypeScript SDK (pinned version) |
| `@polymarket/clob-client` | Polymarket trading |
| `ethers` | Wallet/signing for Polymarket |

### Dev

```bash
bun add -d @biomejs/biome drizzle-kit @types/bun
```

| Package | Purpose |
|---------|---------|
| `@biomejs/biome` | Linter + formatter (replaces ESLint + Prettier) |
| `drizzle-kit` | DB migrations CLI |
| `@types/bun` | Bun type definitions |

**Trade-off: Biome vs ESLint + Prettier**
Biome is a single tool for both linting and formatting, written in Rust, extremely fast. Downside is fewer rules than ESLint, but for a greenfield project the defaults are solid and the speed/simplicity is worth it.

---

## 4. Config files

### biome.json

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2
  }
}
```

### .env.example

Template showing all required env vars (no actual values):

```
POLY_PRIVATE_KEY=
POLY_API_KEY=
POLY_API_SECRET=
POLY_API_PASSPHRASE=
OPENROUTER_API_KEY=
API_SPORTS_KEY=
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
```

### .gitignore

```
node_modules/
.env
*.db
*.db-journal
dist/
.DS_Store
.dockerignore
```

### .dockerignore

```
node_modules/
.env
.git/
.github/
docs/
tests/
*.md
.DS_Store
```

---

## 5. Directory structure

Create empty directory structure with placeholder `index.ts` barrel files where needed:

```
src/
├── index.ts                        # Entry point — minimal HTTP server
├── domain/
│   ├── models/
│   ├── contracts/
│   └── services/
├── infrastructure/
│   ├── polymarket/
│   ├── sports-data/
│   └── database/
│       └── schema.ts
├── engine/
├── competitors/
├── orchestrator/
└── shared/
    ├── env.ts                      # Typed env var loading with Zod
    └── logger.ts                   # Simple logger

tests/
├── unit/
├── integration/
└── e2e/

docs/
├── research.md                     # Already exists
├── features/
│   └── project-setup/
│       └── plan.md                 # This document
├── llm-instructions.md             # Future: instructions for competing LLMs
└── statistics-schema.md            # Future: stats contract docs
```
No barrel files or empty re-exports — just the directories and the files that have actual content.

---

## 6. Minimal entry point

`src/index.ts` — a simple HTTP server to confirm the app runs:

```typescript
const server = Bun.serve({
  port: process.env.PORT ?? 3000,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
});

console.log(`Server running on http://localhost:${server.port}`);
```

No framework — just Bun's built-in `Bun.serve`. We can add Hono or similar later if routing gets complex, but for now this is enough.

---

## 7. Typed environment config

`src/shared/env.ts` — validate env vars at startup using Zod:

```typescript
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  POLY_PRIVATE_KEY: z.string().min(1),
  POLY_API_KEY: z.string().min(1),
  POLY_API_SECRET: z.string().min(1),
  POLY_API_PASSPHRASE: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  API_SPORTS_KEY: z.string().min(1),
  TURSO_DATABASE_URL: z.string().url(),
  TURSO_AUTH_TOKEN: z.string().min(1),
});

export const env = envSchema.parse(process.env);
```

App crashes immediately on startup if any required var is missing — fail fast.

---

## 8. Simple logger

`src/shared/logger.ts` — structured JSON logging:

```typescript
type LogLevel = "info" | "warn" | "error" | "debug";

function log(level: LogLevel, message: string, data?: Record<string, unknown>) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  };
  console.log(JSON.stringify(entry));
}

export const logger = {
  info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
  debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
};
```

No logging library — this is enough for now. Can swap in pino later if needed.

---

## 9. Smoke test

`tests/unit/health.test.ts` — confirm the server starts and responds:

```typescript
import { describe, expect, it } from "bun:test";

describe("health check", () => {
  it("returns ok", async () => {
    const res = await fetch("http://localhost:3000/health");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
  });
});
```

---

## 10. Database migrations

### drizzle.config.ts

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/infrastructure/database/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  },
});
```

### src/infrastructure/database/migrate.ts

Standalone migration runner — can be called from CLI or CI:

```typescript
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

const db = drizzle(client);

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations complete");
process.exit(0);
```

### Workflow

1. Edit `src/infrastructure/database/schema.ts`
2. `bun run db:generate` — generates SQL migration files in `./drizzle/`
3. `bun run db:migrate` — applies pending migrations to Turso

---

## 11. GitHub Actions CI

### .github/workflows/ci.yml

Runs on every push and PR. Lints, typechecks, and tests.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - run: bun install --frozen-lockfile

      - name: Lint
        run: bun run lint

      - name: Typecheck
        run: bun run typecheck

      - name: Test
        run: bun test
```

### .github/workflows/migrate.yml

Manually triggered workflow to run database migrations against Turso.

```yaml
name: Run Migrations

on:
  workflow_dispatch:
    inputs:
      confirm:
        description: "Type 'migrate' to confirm"
        required: true

jobs:
  migrate:
    runs-on: ubuntu-latest
    if: github.event.inputs.confirm == 'migrate'
    environment: production
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - run: bun install --frozen-lockfile

      - name: Run migrations
        run: bun run db:migrate
        env:
          TURSO_DATABASE_URL: ${{ secrets.TURSO_DATABASE_URL }}
          TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}
```

This uses `workflow_dispatch` so it's triggered manually from the GitHub Actions UI, with a confirmation input to prevent accidental runs.

---

## 12. DigitalOcean deployment

### .github/workflows/deploy.yml

Manually triggered. Builds a Docker image, pushes to GitHub Container Registry, then SSHs into the Droplet to pull and restart.

```yaml
name: Deploy

on:
  workflow_dispatch:
    inputs:
      confirm:
        description: "Type 'deploy' to confirm"
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    if: github.event.inputs.confirm == 'deploy'
    environment: production
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push Docker image
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ghcr.io/${{ github.repository }}:latest

      - name: Deploy to Droplet
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DROPLET_HOST }}
          username: ${{ secrets.DROPLET_USER }}
          key: ${{ secrets.DROPLET_SSH_KEY }}
          script: |
            docker pull ghcr.io/${{ github.repository }}:latest
            docker stop llm-betting || true
            docker rm llm-betting || true
            docker run -d \
              --name llm-betting \
              --restart unless-stopped \
              --env-file /opt/llm-betting/.env \
              -p 3000:3000 \
              ghcr.io/${{ github.repository }}:latest
```

### Dockerfile

```dockerfile
FROM oven/bun:latest AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Build stage (copy source)
FROM base AS release
COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
```

### Droplet setup (one-time manual)

1. Create Droplet on DigitalOcean ($6/mo, Ubuntu)
2. Install Docker: `curl -fsSL https://get.docker.com | sh`
3. Log in to GHCR: `echo $GITHUB_TOKEN | docker login ghcr.io -u <username> --password-stdin`
4. Create `/opt/llm-betting/.env` with all secrets
5. First deploy triggers via GitHub Actions UI

### GitHub Secrets required

| Secret | Purpose |
|--------|---------|
| `DROPLET_HOST` | Droplet IP address |
| `DROPLET_USER` | SSH user (e.g. `deploy`) |
| `DROPLET_SSH_KEY` | Private SSH key for the deploy user |
| `TURSO_DATABASE_URL` | For migration workflow |
| `TURSO_AUTH_TOKEN` | For migration workflow |

---

## Files to create

| File | Purpose |
|------|---------|
| `package.json` | Via `bun init`, then add scripts and deps |
| `tsconfig.json` | Strict TS config with path aliases |
| `biome.json` | Linter + formatter config |
| `drizzle.config.ts` | Drizzle Kit config pointing at Turso |
| `.env.example` | Env var template |
| `.gitignore` | Ignore node_modules, .env, etc. |
| `src/index.ts` | Minimal HTTP server with /health endpoint |
| `src/shared/env.ts` | Zod-validated env vars |
| `src/shared/logger.ts` | Simple structured logger |
| `src/infrastructure/database/migrate.ts` | Standalone migration runner |
| `tests/unit/health.test.ts` | Smoke test |
| `.github/workflows/ci.yml` | CI pipeline — lint, typecheck, test |
| `.github/workflows/migrate.yml` | Manual migration runner |
| `.github/workflows/deploy.yml` | Manual deploy to DigitalOcean Droplet via Docker |
| `Dockerfile` | Multi-stage Bun Docker image |
| `.dockerignore` | Keep image lean |

## Directories to create (empty for now)

- `src/domain/models/`
- `src/domain/contracts/`
- `src/domain/services/`
- `src/infrastructure/polymarket/`
- `src/infrastructure/sports-data/`
- `src/infrastructure/database/`
- `src/engine/`
- `src/competitors/`
- `src/orchestrator/`
- `tests/integration/`
- `tests/e2e/`

---

## 13. Code Standards

### Domain-Driven Design (DDD)

- **`src/domain/`** is the core — pure business logic with zero external dependencies. No imports from `infrastructure/`, no HTTP, no database, no SDK calls.
- **`src/infrastructure/`** implements the integrations (Polymarket, sports data, database). It depends on domain types but domain never depends on it.
- **Dependency direction**: `orchestrator → engine → domain ← infrastructure`. Infrastructure adapts the outside world to domain contracts, not the other way around.
- Domain models are plain TypeScript types/classes — no ORM decorators, no framework coupling.

### Test-Driven Development (TDD)

- Write tests before or alongside implementation — not as an afterthought.
- Every public function in `domain/` and `engine/` must have unit tests.
- Use the **Arrange → Act → Assert** pattern consistently.
- Test naming: `it("returns YES when home team has higher win rate")` — describe the behaviour, not the implementation.
- Contracts (Zod schemas) must have validation tests covering both valid and invalid inputs.
- Integration tests mock external APIs at the HTTP boundary — never mock domain logic.

### Clean Code

- **Single responsibility**: one module, one reason to change. If a file does two unrelated things, split it.
- **Small functions**: if a function needs a comment to explain what it does, it's too long — extract and name the parts.
- **No dead code**: no commented-out code, no unused imports, no placeholder functions that do nothing.
- **Explicit over implicit**: prefer named types over `any`/`unknown`, prefer explicit returns over implicit, prefer clear names over abbreviations.
- **Assertions**: use Node's built-in `assert` to enforce invariants. If an assertion fails, the process crashes — this is intentional. A crashed process is better than one running in an invalid state. Use asserts for things that should never happen (e.g. a prediction engine returning a confidence > 1, a market missing a token ID). Zod validates at boundaries; asserts guard invariants within domain logic.
- **Error handling**: fail fast at boundaries (Zod validation on API responses, env vars). Domain functions use asserts for invariants rather than defensive null checks.
- **Consistent naming**: `camelCase` for variables/functions, `PascalCase` for types/interfaces, `UPPER_SNAKE` for constants/env vars.

---

## Todo List

### Phase 1: Project initialisation

- [x] 1.1 Run `bun init` to generate `package.json`, `tsconfig.json`, `index.ts`
- [x] 1.2 Update `tsconfig.json` — strict mode, path aliases (`@domain/*`, `@infrastructure/*`, etc.), `include` array
- [x] 1.3 Update `package.json` — add all scripts (`dev`, `start`, `test`, `typecheck`, `lint`, `lint:fix`, `db:generate`, `db:migrate`, `db:studio`)

### Phase 2: Dependencies

- [x] 2.1 Install runtime deps: `zod`, `drizzle-orm`, `@libsql/client`, `@openrouter/sdk`, `@polymarket/clob-client`, `ethers`
- [x] 2.2 Install dev deps: `@biomejs/biome`, `drizzle-kit`, `@types/bun`

### Phase 3: Config files

- [x] 3.1 Create `biome.json` — recommended rules, space indent, organise imports
- [x] 3.2 Create `.env.example` — all env var names, no values
- [x] 3.3 Update `.gitignore` — node_modules, .env, *.db, dist, .DS_Store, .dockerignore
- [x] 3.4 Create `.dockerignore` — node_modules, .env, .git, docs, tests, *.md

### Phase 4: Directory structure

- [x] 4.1 Create `src/domain/models/`
- [x] 4.2 Create `src/domain/contracts/`
- [x] 4.3 Create `src/domain/services/`
- [x] 4.4 Create `src/infrastructure/polymarket/`
- [x] 4.5 Create `src/infrastructure/sports-data/`
- [x] 4.6 Create `src/infrastructure/database/`
- [x] 4.7 Create `src/engine/`
- [x] 4.8 Create `src/competitors/`
- [x] 4.9 Create `src/orchestrator/`
- [x] 4.10 Create `src/shared/`
- [x] 4.11 Create `tests/unit/`
- [x] 4.12 Create `tests/integration/`
- [x] 4.13 Create `tests/e2e/`

### Phase 5: Core source files

- [x] 5.1 Create `src/shared/env.ts` — Zod schema for all env vars, `envSchema.parse(process.env)`, export `env`
- [x] 5.2 Create `src/shared/logger.ts` — structured JSON logger with `info`, `warn`, `error`, `debug` methods
- [x] 5.3 Create `src/index.ts` — `Bun.serve` with `/health` endpoint returning `{ status: "ok" }`, 404 fallback

### Phase 6: Database setup

- [x] 6.1 Create `drizzle.config.ts` — point at Turso, schema path `./src/infrastructure/database/schema.ts`, output `./drizzle`
- [x] 6.2 Create `src/infrastructure/database/schema.ts` — empty placeholder (tables added in future features)
- [x] 6.3 Create `src/infrastructure/database/migrate.ts` — standalone migration runner using `drizzle-orm/libsql/migrator`

### Phase 7: Tests

- [x] 7.1 Create `tests/unit/health.test.ts` — smoke test: start server, fetch `/health`, assert 200 + `{ status: "ok" }`

### Phase 8: CI/CD & Deployment

- [x] 8.1 Create `.github/workflows/ci.yml` — lint, typecheck, test on push/PR to main
- [x] 8.2 Create `.github/workflows/migrate.yml` — manual trigger with confirmation, runs `db:migrate`
- [x] 8.3 Create `.github/workflows/deploy.yml` — manual trigger, build Docker image, push to GHCR, SSH deploy to Droplet
- [x] 8.4 Create `Dockerfile` — multi-stage Bun image (deps → release), expose 3000
- [x] 8.5 Create `.dockerignore`  (covered in 3.4 — verify consistency)

### Phase 9: Verification

- [x] 9.1 Run `bun run lint` — confirm Biome passes with no errors
- [x] 9.2 Run `bun run typecheck` — confirm TypeScript compiles with no errors
- [x] 9.3 Run `bun test` — confirm health check smoke test passes
- [x] 9.4 Run `bun run dev` — confirm server starts and `/health` responds