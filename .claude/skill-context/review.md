## Project: LLM Betting Competition — Code Review Context

Refer to `.claude/skill-context/planning.md` for architecture overview. This file describes what to specifically look for when reviewing code in this codebase.

---

## Critical: Never Expose Sensitive Data

- Wallet credentials (private key, API key, secret, passphrase) must never appear in API responses, logs, or error messages
- `competitor_versions.rawLlmOutput` and `.code` (weight config) must not be surfaced via the API
- Only `hasWallet: boolean` and `walletAddress: string` are safe to expose
- Check every new API route and every new log call

---

## TypeScript Strictness

This project uses `"strict": true` in `tsconfig.json`. Flag any:
- Missing return types on exported functions
- Use of `any` (should be `unknown` + narrowing, or a proper typed interface)
- Non-null assertions (`!`) without a clear guard preceding them
- Type casting (`as X`) that papers over an actual type mismatch
- Unhandled `Promise<void>` (should be `await`-ed or have explicit fire-and-forget reasoning)

---

## Factory Function Pattern Compliance

All services must use factory functions with injected deps — not classes, not module-level singletons, not direct imports of infrastructure inside domain code:

```typescript
// CORRECT
export function createBettingService(deps: { bettingClient: ..., betsRepo: ... }) { ... }

// WRONG — direct import of infrastructure in domain
import { db } from "@database/client";
```

Domain services must not import from `@infrastructure/*` directly. Infrastructure is injected via factory args.

---

## Zod Validation at Boundaries

Check that all external data is validated before use:
- LLM-generated weight configs (already validated via `validateWeights()`)
- Polymarket API responses (validated in mappers/clients)
- API request query params (validate with Zod before use if non-trivial)
- Engine output (`predictionOutputSchema` via `validatePredictions()`)

Internal domain-to-domain function calls do not need Zod — TypeScript is sufficient.

---

## Repository Pattern Compliance

- Repos must take `db` as a parameter (dependency injection) — never import `db` globally inside a repo file
- New DB tables need a corresponding repo file in `src/database/repositories/`
- Batch operations should use `bulkUpsert` — no N+1 insert loops
- Check that `onConflictDoUpdate` sets correct `target` columns

---

## Database Schema Changes

If the diff includes changes to `src/database/schema.ts`:
- There must be a new migration file in `drizzle/`
- The migration must have been generated with `bunx drizzle-kit generate` (not hand-written SQL unless trivial)
- Check that existing nullable fields default sensibly and won't break existing rows

---

## Test Coverage

Every new service function and repository method needs unit tests. Flag any of:
- Public functions without corresponding tests
- Tests that use real DB connections instead of in-memory SQLite
- Tests that use real HTTP/API calls instead of mocks
- Tests only covering happy path (missing error cases, edge cases)
- Repository tests that don't set up the schema before running

Test file location must mirror source: `src/x/y.ts` → `tests/unit/x/y.test.ts`

---

## Betting & Financial Logic

This code handles real money. Extra care in:
- Stake calculation — must respect `maxStakePerBet`, `maxBetPctOfBankroll`, `maxTotalExposure`
- Bankroll calculation — `initialBankroll + settledP&L − pendingExposure` (not just settled P&L)
- Settlement profit: `profit = shares * 1.0 - amount` (won) or `profit = -amount` (lost)
- Duplicate bet prevention — one prediction per fixture per competitor
- Idempotency — settlement must skip already-settled bets, not double-settle

---

## Logging Conventions

- `logger.info/warn/error/debug` only — never `console.log`
- Structured data as second arg: `logger.error("msg", { field: value })`
- Sensitive fields must never appear in log data

---

## Environment Variables

- All env vars must be added to `src/shared/env.ts` and validated with Zod
- No `process.env.SOMETHING` calls outside of `src/shared/env.ts`
- New required vars need documentation (what they're for, where to get them)

---

## Path Aliases

No relative cross-module imports. All cross-module imports must use `@domain/*`, `@shared/*`, `@infrastructure/*`, `@engine/*`, `@competitors/*`, `@orchestrator/*` aliases.

Relative imports (`./`, `../`) are only acceptable within the same module directory.

---

## API Response Types

- New API endpoints must add their response type to `src/shared/api-types.ts`
- Route handler must use `satisfies ResponseType` or explicit `c.json<ResponseType>()` to keep types in sync with the UI
- All endpoints are GET and read-only — flag any POST/PUT/DELETE additions without discussion
