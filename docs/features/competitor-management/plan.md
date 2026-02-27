# Database-Driven Competitor Management — Plan

## Context

Competitors are currently hardcoded in `src/index.ts` — the baseline, three LLM runtime engines, and any codegen engines are registered imperatively at startup. There's no way to enable/disable competitors without code changes, no status tracking (pending, error states), and no type classification. The `competitors` table has a basic `active` boolean but it isn't used for startup loading.

This change makes the database the source of truth for competitor configuration. Competitors are inserted via migration (not runtime seeding), loaded from the DB at startup, and can be managed via status/type fields. Eventually a UI will manage competitors; until then, migrations and direct DB edits handle configuration. This also lays the groundwork for external (Discord community) competitors later.

---

## Schema Changes

### `competitors` table — modify existing

**File:** `src/infrastructure/database/schema.ts`

| Column | Change | Type | Notes |
|--------|--------|------|-------|
| `status` | **ADD** | `text NOT NULL DEFAULT 'active'` | Replaces `active` boolean. Values: `active`, `disabled`, `pending`, `error` |
| `type` | **ADD** | `text NOT NULL DEFAULT 'codegen'` | Values: `baseline`, `runtime`, `codegen`, `external` |
| `config` | **ADD** | `text` (nullable, JSON) | Type-specific config (see below) |
| `active` | **DROP** | — | Replaced by `status` |

The `config` JSON column stores type-specific settings:
- **baseline**: `null` (no config needed)
- **runtime**: `{ "model": "anthropic/claude-sonnet-4" }` — which OpenRouter model to use
- **codegen**: `{ "model": "anthropic/claude-sonnet-4" }` — which LLM generates the code
- **external**: `{ "webhookUrl": "...", "apiKey": "..." }` — future, not implemented yet

### Migration

Generate via `bun run db:generate` after schema changes. The migration will:

1. Add `status`, `type`, `config` columns and drop `active`
2. Insert the four built-in competitors (baseline + 3 runtime engines)

The data insert is appended manually to the generated migration SQL — Drizzle generates the schema DDL, then we add the `INSERT` statements:

```sql
-- Built-in competitors (inserted once via migration, managed via DB thereafter)
INSERT INTO `competitors` (`id`, `name`, `type`, `status`, `model`, `engine_path`, `config`, `created_at`)
VALUES
  ('baseline', 'Manual Baseline', 'baseline', 'active', 'heuristic', 'src/competitors/baseline/engine.ts', NULL, unixepoch()),
  ('claude-runtime', 'Claude Sonnet (Runtime)', 'runtime', 'active', 'anthropic/claude-sonnet-4', NULL, '{"model":"anthropic/claude-sonnet-4"}', unixepoch()),
  ('gpt4o-runtime', 'GPT-4o (Runtime)', 'runtime', 'active', 'openai/gpt-4o', NULL, '{"model":"openai/gpt-4o"}', unixepoch()),
  ('gemini-runtime', 'Gemini Flash (Runtime)', 'runtime', 'active', 'google/gemini-2.0-flash-001', NULL, '{"model":"google/gemini-2.0-flash-001"}', unixepoch());
```

---

## Type Definitions

**New file:** `src/domain/types/competitor.ts`

```typescript
const COMPETITOR_STATUSES = ["active", "disabled", "pending", "error"] as const;
type CompetitorStatus = (typeof COMPETITOR_STATUSES)[number];

const COMPETITOR_TYPES = ["baseline", "runtime", "codegen", "external"] as const;
type CompetitorType = (typeof COMPETITOR_TYPES)[number];

type RuntimeConfig = { model: string };
type CodegenConfig = { model: string };
type ExternalConfig = { webhookUrl: string; apiKey: string };
type CompetitorConfig = RuntimeConfig | CodegenConfig | ExternalConfig | null;
```

---

## Competitor Loader

**New file:** `src/competitors/loader.ts`

Reads active competitors from the DB and builds `RegisteredEngine[]`. Replaces the hardcoded registration block in `index.ts`.

```typescript
type LoaderDeps = {
  competitorsRepo: CompetitorsRepo;
  openrouterClient: OpenRouterClient | null;
};

async function loadCompetitors(deps: LoaderDeps): Promise<RegisteredEngine[]>
```

**Per-type loading logic:**

1. Query `findByStatus('active')`
2. For each competitor, based on `type`:
   - **baseline** — import `baselineEngine` from the known hardcoded path
   - **runtime** — skip if no OpenRouter client; otherwise `createLlmRuntimeEngine({ client, model: config.model })`
   - **codegen** — dynamic import from `enginePath` using existing `loadCodegenEngine()`
   - **external** — skip with info log (not yet implemented)
3. If loading fails (bad import, missing config), log error and set competitor status to `error` in DB
4. Return successfully loaded engines

---

## Startup Flow (index.ts)

**Before** (hardcoded):
```
1. Create registry
2. Manually register baseline
3. If OpenRouter → manually register 3 LLM engines
4. Pass registry to pipeline
```

**After** (database-driven):
```
1. engines = await loadCompetitors({ repo, openrouterClient })
2. Create registry, register all loaded engines
3. Log which competitors loaded and which were skipped
4. Pass registry to pipeline
```

No runtime seeding — the migration handles inserting built-in competitors. To add/disable competitors, update the DB directly (or via a future UI).

---

## Repository Changes

**File:** `src/infrastructure/database/repositories/competitors.ts`

- **Add** `findByStatus(status: string)` — query competitors by status
- **Add** `findAll()` — return all competitors regardless of status (for admin/UI use)
- **Add** `setStatus(id, status)` — update status field
- **Remove** `findActive()` — replaced by `findByStatus('active')`
- **Remove** `setActive()` — replaced by `setStatus()`

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `src/domain/types/competitor.ts` | **CREATE** | Status, type, and config type definitions |
| `src/competitors/loader.ts` | **CREATE** | DB-driven competitor loading |
| `src/infrastructure/database/schema.ts` | **MODIFY** | Add `status`, `type`, `config`; drop `active` |
| `src/infrastructure/database/repositories/competitors.ts` | **MODIFY** | Add `findByStatus`, `findAll`, `setStatus`; remove `findActive`, `setActive` |
| `src/index.ts` | **MODIFY** | Replace hardcoded registration with DB-driven load |
| `drizzle/0002_*.sql` | **GENERATE** | Migration for schema changes + built-in competitor inserts |
| `tests/unit/competitors/loader.test.ts` | **CREATE** | Loader tests |

### Files NOT modified

- `src/competitors/registry.ts` — unchanged, still the in-memory runtime registry
- `src/competitors/baseline/engine.ts` — unchanged
- `src/competitors/llm-runtime/engine.ts` — unchanged
- `src/competitors/llm-codegen/` — unchanged (iteration still works the same)
- `src/engine/` — unchanged (runner, validator, types)
- `src/orchestrator/` — unchanged (pipeline still uses `registry.getAll()`)

---

## Verification

- [ ] `bun run db:generate` produces a clean migration
- [ ] `bun run db:migrate` applies without errors
- [ ] `bun test` — all existing + new tests pass
- [ ] `bun run typecheck` — clean
- [ ] `bun run lint:fix` — clean
- [ ] App starts with just `API_SPORTS_KEY` + DB (no OpenRouter) → only baseline loads
- [ ] App starts with all keys → baseline + 3 runtime engines load
