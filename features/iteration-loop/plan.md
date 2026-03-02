# Feature 12: Iteration Loop — Plan

## Goal

A service and CLI script that iterates codegen competitors: gathers their performance data, builds a feedback prompt with their code + stats + leaderboard, calls the LLM to generate improved engine code, validates it, saves a new version, and updates the registry.

---

## Files to Create

### 1. `src/infrastructure/database/schema.ts` (modify)

Add a `competitorVersions` table for version history:

```typescript
export const competitorVersions = sqliteTable("competitor_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  competitorId: text("competitor_id").notNull().references(() => competitors.id),
  version: integer("version").notNull(),
  code: text("code").notNull(),
  enginePath: text("engine_path").notNull(),
  model: text("model").notNull(),
  performanceSnapshot: text("performance_snapshot", { mode: "json" }).$type<PerformanceSnapshot>(),
  generatedAt: integer("generated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
```

`PerformanceSnapshot` type: `{ totalBets, wins, losses, accuracy, roi, profitLoss }` — captured at iteration time so we can track improvement across versions.

### 2. `src/infrastructure/database/repositories/competitor-versions.ts`

Repository for version history.

**Exports:**
- `competitorVersionsRepo(db)` → `{ create, findByCompetitor, findLatest, findByVersion }`

**Methods:**
- `create(version)` — insert new version record
- `findByCompetitor(competitorId)` — all versions for a competitor, ordered by version desc
- `findLatest(competitorId)` — most recent version
- `findByVersion(competitorId, version)` — specific version

### 3. `src/competitors/llm-codegen/feedback.ts`

Builds the feedback prompt for iteration.

**Exports:**
- `buildFeedbackPrompt(params: FeedbackPromptInput): string`

**`FeedbackPromptInput` type:**
```typescript
type FeedbackPromptInput = {
  currentCode: string;
  performance: PerformanceStats;
  recentOutcomes: PredictionOutcome[];
  leaderboard: LeaderboardEntry[];
};

type PredictionOutcome = {
  marketQuestion: string;
  side: "YES" | "NO";
  confidence: number;
  stake: number;
  result: "won" | "lost" | "pending";
  profit: number | null;
};

type LeaderboardEntry = {
  name: string;
  accuracy: number;
  roi: number;
  profitLoss: number;
};
```

**How it works:**
Formats a user prompt with:
1. The competitor's current engine code
2. Summary stats (accuracy, ROI, P&L)
3. Table of recent predictions with outcomes (last 20)
4. Leaderboard showing all competitors ranked by P&L
5. Specific improvement suggestions based on patterns (e.g., "you're losing on away team bets")

### 4. `src/competitors/llm-codegen/iteration.ts`

Orchestration service for the iteration loop.

**Exports:**
- `createIterationService(deps: IterationDeps)` → `{ iterateCompetitor, iterateAll, buildLeaderboard }`

**`IterationDeps` type:**
```typescript
type IterationDeps = {
  client: OpenRouterClient;
  competitorsRepo: ReturnType<typeof competitorsRepoFactory>;
  versionsRepo: ReturnType<typeof competitorVersionsRepoFactory>;
  betsRepo: ReturnType<typeof betsRepoFactory>;
  predictionsRepo: ReturnType<typeof predictionsRepoFactory>;
  marketsRepo: ReturnType<typeof marketsRepoFactory>;
  registry: CompetitorRegistry;
};
```

**Methods:**

`buildLeaderboard()`:
1. Fetch all active competitors
2. Get performance stats for each
3. Sort by profitLoss descending
4. Return `LeaderboardEntry[]`

`iterateCompetitor(competitorId: string)`:
1. Fetch competitor record from DB
2. Read current engine code from `enginePath`
3. Get performance stats via `betsRepo.getPerformanceStats()`
4. Get recent predictions + bets, join to build `PredictionOutcome[]`
5. Build leaderboard via `buildLeaderboard()`
6. Call `buildFeedbackPrompt()` with all gathered data
7. Call LLM via `createCodeGenerator` with the feedback as user prompt (reuse the existing system prompt from generator.ts, but override the user prompt)
8. Validate new code via `validateGeneratedCode()`
9. If invalid: log error, return failure result
10. If valid:
    - Determine next version number from `versionsRepo.findLatest()`
    - Save code to versioned path: `src/competitors/<id>/engine_v{N}.ts`
    - Insert `competitorVersions` record with performance snapshot
    - Update `competitors.enginePath` to new versioned path
    - Re-register in the in-memory registry
    - Return success result with version info

`iterateAll()`:
1. Fetch all active codegen competitors (filter by model field — runtime competitors don't iterate)
2. Sequentially call `iterateCompetitor()` for each
3. Return summary of results

### 5. `src/scripts/iterate.ts`

CLI script to trigger iteration manually.

**Usage:** `bun run src/scripts/iterate.ts [--competitor <id>]`

**How it works:**
1. Reads env, creates DB, repos, OpenRouter client
2. Creates iteration service
3. If `--competitor` flag: iterate just that competitor
4. Otherwise: iterate all active codegen competitors
5. Logs results (version number, validation status, performance snapshot)

### 6. `tests/unit/competitors/llm-codegen/feedback.test.ts`

Tests for feedback prompt builder.

**Test cases:**
- Prompt includes current engine code
- Prompt includes performance stats (accuracy, ROI, P&L)
- Prompt includes recent outcomes with win/loss indicators
- Prompt includes leaderboard
- Handles zero bets (new competitor with no history)
- Handles all losses gracefully
- Truncates outcomes list to last 20

### 7. `tests/unit/competitors/llm-codegen/iteration.test.ts`

Tests for iteration service.

**Test cases:**
- `buildLeaderboard` aggregates stats and sorts by P&L
- `iterateCompetitor` calls generator with feedback prompt
- `iterateCompetitor` validates generated code
- `iterateCompetitor` saves version to DB on success
- `iterateCompetitor` returns failure on validation error (doesn't save)
- `iterateCompetitor` increments version number correctly
- `iterateAll` iterates each codegen competitor sequentially

---

## Files Modified

### `src/infrastructure/database/schema.ts`
Add `competitorVersions` table (described above).

### `src/competitors/llm-codegen/engine.ts`
Update `saveGeneratedEngine` to accept an optional `version` parameter for versioned file paths:
```typescript
export async function saveGeneratedEngine(params: {
  competitorId: string;
  code: string;
  version?: number;
}): Promise<string> {
  const engineDir = resolve("src/competitors", params.competitorId);
  await mkdir(engineDir, { recursive: true });
  const filename = params.version ? `engine_v${params.version}.ts` : "engine.ts";
  const enginePath = resolve(engineDir, filename);
  await Bun.write(enginePath, params.code);
  return enginePath;
}
```

### `src/competitors/llm-codegen/generator.ts`
Extract the `SYSTEM_PROMPT` and `CODE_JSON_SCHEMA` as named exports so the iteration service can reuse them:
```typescript
export const CODEGEN_SYSTEM_PROMPT = `...`;  // rename from SYSTEM_PROMPT
export const CODE_JSON_SCHEMA = { ... };      // already const, just export
```

Also add a `generateWithFeedback` method that accepts a custom user prompt (the feedback prompt) instead of the generic "generate a unique engine" prompt.

### `src/competitors/registry.ts`
Add an `unregister` method to support replacing engines:
```typescript
unregister(competitorId: string): boolean {
  return this.engines.delete(competitorId);
}
```

### `package.json`
Add script: `"iterate": "bun run src/scripts/iterate.ts"`

---

## Not in Scope

- Automatic iteration scheduling (start manual, add later)
- Automatic rollback if new version underperforms
- Backtesting new versions against historical fixtures
- A/B testing old vs new engine
- UI for version comparison
- Runtime LLM engine iteration (they don't have saved code to iterate on)

## Dependencies

No new packages.

## DB Migration

Run `bun run db:generate` after schema changes to create the migration, then `bun run db:migrate` to apply.

## Verification

- [ ] `bun test` — all tests pass
- [ ] `bun run typecheck` — clean
- [ ] `bun run lint:fix` — clean
- [ ] `bun run db:generate` — migration generates cleanly
