# Feature 12: Iteration Loop — Research

## Goal

Feed results back to LLMs so they can improve their prediction engines. After bets are settled and scored, each LLM receives its current code, performance stats, and a leaderboard — then rewrites its engine to improve.

## Existing Infrastructure

### Settlement & Scoring — Ready

- `createSettlementService()` resolves markets from Gamma API, calculates profit/loss, updates bet status to `settled_won`/`settled_lost`
- `betsRepo.getPerformanceStats(competitorId)` → `{ totalBets, wins, losses, pending, totalStaked, totalReturned, profitLoss, accuracy, roi }`
- `betsRepo.findByCompetitor(competitorId)` → all bets for a competitor
- `predictionsRepo.findByCompetitor(competitorId)` → all predictions with reasoning, confidence, stake

### Codegen Pipeline — Ready

- `createCodeGenerator({ client })` → `generateEngine({ model, competitorId })` → `{ competitorId, code, model }`
- `validateGeneratedCode(code)` → writes temp file, imports, runs against `SAMPLE_STATISTICS`, validates with Zod
- `saveGeneratedEngine({ competitorId, code })` → writes to `src/competitors/<competitorId>/engine.ts`
- `loadCodegenEngine(enginePath)` → dynamically imports saved engine

### Competitor Tracking — Partial

**DB schema (`competitors` table):**
- `id` (text PK), `name`, `model`, `enginePath`, `active` (boolean), `createdAt`
- `competitorsRepo`: `create()`, `findById()`, `findActive()`, `setActive()`

**In-memory registry:**
- `registry.register(id, name, engine)`, `getAll()`, `get(id)`

**Missing:** No version tracking. `saveGeneratedEngine()` overwrites `engine.ts` — no history.

### OpenRouter Client — Ready

- Supports structured output with JSON schema
- Handles multiple models (Claude, GPT-4o, Gemini)
- Already used by codegen generator

## What's Missing

### 1. Version History

No `competitor_versions` table. No way to track iteration history, roll back, or see what code produced what results. The `competitors` table has no version number or iteration count.

### 2. Feedback Prompt Builder

Nothing synthesizes performance data into a prompt for the LLM. Need to:
- Read competitor's current engine code from disk
- Query `getPerformanceStats()` for the competitor
- Query recent predictions + outcomes (join predictions with settled bets)
- Build a leaderboard across all competitors
- Format into a feedback prompt

### 3. Iteration Orchestration

No service to drive the full cycle: trigger → gather feedback → generate → validate → save version → update registry.

### 4. Engine Hot-Reload

Currently engines are imported at startup in `src/index.ts`. No mechanism to swap an engine mid-runtime. Options:
- **Process restart** after iteration (simplest)
- **Dynamic re-import** at next pipeline run (requires clearing module cache)
- **Version path swap** — load from versioned path, registry update replaces old engine

### 5. Rollback Strategy

If a new version performs worse, there's no way to revert. Need to keep previous versions on disk and in DB.

## Design Considerations

### Iteration Trigger

| Option | Pros | Cons |
|--------|------|------|
| Manual CLI command | Full control, safe | Requires human intervention |
| After N settled bets | Data-driven | Complex trigger logic |
| On schedule (weekly) | Predictable | May iterate with insufficient data |
| Threshold-based (accuracy < X%) | Targeted | Requires tuning threshold |

**Recommendation:** Start with manual CLI trigger. Add scheduled iteration later.

### Version Storage

**Option A — Separate `competitor_versions` table (recommended):**
```
competitor_versions:
  id (auto PK), competitorId (FK), version (int),
  code (text), enginePath (text), model (text),
  performanceSnapshot (JSON), feedbackPrompt (text),
  generatedAt (timestamp)
```

Pros: clean history, queryable, supports rollback. Cons: extra table, migration needed.

**Option B — Git-only versioning:**
Just overwrite the file and rely on git history. Simpler but harder to query programmatically.

**Recommendation:** Option A. The `competitor_versions` table gives programmatic access to version history, rollback, and performance tracking at each iteration.

### Feedback Prompt Content

What the LLM should receive:
1. **Its current engine code** — so it knows what it wrote
2. **Summary performance stats** — wins, losses, accuracy, ROI, P&L
3. **Recent prediction outcomes** — last N predictions with side, confidence, actual result, profit
4. **Leaderboard** — how it ranks against other competitors
5. **Improvement instructions** — what to focus on

### Concurrency

Iterate competitors sequentially, not in parallel. Simpler, avoids race conditions in the registry, and each iteration gets the latest leaderboard including results from competitors that just iterated.

### Safety

- Always validate generated code before saving
- Keep previous version on disk (versioned paths)
- Don't auto-deploy to production — iteration is a local/manual operation (consistent with Feature 11's safety approach)
- Codegen engines are NOT runtime LLM engines — they're static code that gets committed

## Data Flow

```
1. TRIGGER (manual CLI)
   ↓
2. GATHER PERFORMANCE
   → competitorsRepo.findActive()
   → betsRepo.getPerformanceStats(each)
   → Build leaderboard
   ↓
3. FOR EACH CODEGEN COMPETITOR:
   a. Read current engine code from disk
   b. Get recent predictions + outcomes
   c. Build feedback prompt (code + stats + leaderboard + instructions)
   d. Call LLM via OpenRouter (structured output → { code })
   e. Validate new code (temp file → import → run → Zod check)
   f. If valid: save as new version, update competitor record
   g. If invalid: log error, keep current version
   ↓
4. UPDATE REGISTRY
   → Re-register engines from new paths
   ↓
5. COMMIT
   → Git add + commit new version files
```

## Out of Scope

- Automatic rollback (future iteration)
- A/B testing old vs new engine
- Backtesting against historical fixtures
- UI for version comparison
- Automatic iteration scheduling (start manual, add later)
