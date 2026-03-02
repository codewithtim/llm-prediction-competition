# Weight Generation Cleanup — Plan

## Context

The system has all the pieces for LLM-driven weight generation: a system prompt, structured JSON schema, OpenRouter integration, Zod validation, and an `iterate` script. Three competitors are seeded via migration (`wt-claude-sonnet`, `wt-gpt-4o`, `wt-gemini-flash`). However, the flow has never been run end-to-end, and there are several issues that need fixing before it works cleanly and repeatably.

### Current flow

```
bun run iterate [--competitor <id>]
  1. Load competitor from DB
  2. Find latest version (or fall back to DEFAULT_WEIGHTS)
  3. Build feedback prompt (stats, outcomes, leaderboard)
  4. Call OpenRouter → LLM generates JSON weights
  5. Validate via Zod + runtime test
  6. Save as new version in competitor_versions
```

### Problems

1. **Cold-start path is suboptimal** — `iterateCompetitor()` always uses `generateWithFeedback()`, even for brand-new competitors with zero history. The prompt will say "Total Bets: 0" and "No predictions yet." with an empty leaderboard. There's a `generateWeights()` method (cold-start, simpler prompt) that's defined in `generator.ts` but never called.

2. **Feedback prompt says "Generate a complete, improved TypeScript engine"** — line 176 of `feedback.ts`. Leftover from when competitors wrote code instead of tuning weights. JSON schema enforcement prevents bad output, but it's confusing to the LLM and wastes prompt tokens on a misleading instruction.

3. **Model IDs may be stale** — migration 0001 inserts `anthropic/claude-sonnet-4` but the current model family is `claude-sonnet-4-6`. Gemini model ID (`google/gemini-2.0-flash-001`) may also be outdated. Need to verify against OpenRouter's current model catalogue.

4. **No way to add new competitors without writing SQL** — no `competitor:add` CLI command. Adding a model like `deepseek/deepseek-r1` requires manually crafting an INSERT or writing a migration.

5. **`OPENROUTER_API_KEY` defaults to `""` in `env.ts`** — `z.string().default("")` means it passes validation silently. The iterate script will only fail at runtime with a cryptic API error.

6. **`minEdge` and `kellyFraction` are dead parameters** — the LLM is asked to tune them, they're validated and stored, but `engine.ts` never reads them. The LLM wastes effort optimising values that have zero effect. (Low priority — doesn't break anything.)

---

## Changes

### 1. Use cold-start prompt for first-ever generation

**File:** `src/competitors/weight-tuned/iteration.ts`

In `iterateCompetitor()`, after checking `latestVersion`, branch on whether a version exists:

- **No version exists** (`latestVersion === null`): call `generator.generateWeights({ model, competitorId })` — the simpler cold-start prompt that asks the LLM to be creative with its initial weights.
- **Version exists**: call `generator.generateWithFeedback(...)` — the full feedback prompt with performance data, outcomes, and leaderboard (current behaviour).

This gives the LLM a cleaner starting point and avoids a confusing sparse feedback prompt on first run.

### 2. Fix feedback prompt text

**File:** `src/competitors/weight-tuned/feedback.ts`

Line 176 — change:
```
Generate a complete, improved TypeScript engine that addresses these weaknesses.
```
to:
```
Generate an improved weight configuration that addresses these weaknesses.
```

Also update the preamble on line 141 from "Review your current code and performance data" to "Review your current weight configuration and performance data."

### 3. Verify and update model IDs

Check OpenRouter's current model catalogue for the correct IDs. If already deployed to prod (migration 0001 already run), create a new migration to update the `model` and `config` columns:

**File:** `drizzle/XXXX_update-model-ids.sql`

```sql
UPDATE competitors SET model = '...', config = '...' WHERE id = 'wt-claude-sonnet';
UPDATE competitors SET model = '...', config = '...' WHERE id = 'wt-gpt-4o';
UPDATE competitors SET model = '...', config = '...' WHERE id = 'wt-gemini-flash';
```

The exact model strings need to be verified at implementation time against OpenRouter's docs.

### 4. Create `add-competitor.ts` script

**File:** `src/scripts/add-competitor.ts`

CLI script to insert a new weight-tuned competitor into the database:

```
Usage:
  bun run competitor:add -- --id <id> --name <name> --model <openrouter-model-id>
```

The script should:
- Validate args (all three required)
- Check the competitor doesn't already exist
- Insert into `competitors` table with `type: "weight-tuned"`, `status: "active"`
- Print confirmation with next steps ("Run `bun run iterate --competitor <id>` to generate initial weights")

**File:** `package.json`

Add script entry: `"competitor:add": "bun run src/scripts/add-competitor.ts"`

### 5. Guard for empty OpenRouter API key in iterate script

**File:** `src/scripts/iterate.ts`

Add an early check at the top of `main()`:

```typescript
if (!env.OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY is not set. Cannot generate weights.");
  process.exit(1);
}
```

This gives a clear error message instead of a cryptic API failure deep in the call stack.

---

## Post-implementation: end-to-end workflow

After these changes, the workflow for managing competitors and their weights:

```bash
# Add a new competitor
bun run competitor:add -- --id wt-deepseek-r1 --name "Weight-Tuned DeepSeek R1" --model deepseek/deepseek-r1

# Generate initial weights (cold-start prompt, no feedback)
bun run iterate --competitor wt-deepseek-r1
# → Saves version 1 with LLM-generated weights

# Later, after bets have been placed and settled...
# Iterate with feedback (performance data, leaderboard)
bun run iterate --competitor wt-deepseek-r1
# → Saves version 2 with improved weights based on results

# Iterate all active competitors at once
bun run iterate
```

---

## To-do list

- [ ] **1. Cold-start path** — branch on `latestVersion === null` in `iteration.ts` to use `generateWeights()` for first generation
- [ ] **2. Fix feedback prompt** — update "TypeScript engine" references in `feedback.ts` to "weight configuration"
- [ ] **3. Verify model IDs** — check OpenRouter for current model IDs, create migration if needed
- [ ] **4. Create `add-competitor.ts`** — CLI script to insert new competitors, add `competitor:add` to package.json
- [ ] **5. API key guard** — add early `OPENROUTER_API_KEY` check in `iterate.ts`
- [ ] **6. Test end-to-end** — run `bun run iterate --competitor wt-gpt-4o` and verify a version is saved to DB
- [ ] **7. Update `docs/research.md`** — add `competitor:add` to the directory structure and scripts sections
