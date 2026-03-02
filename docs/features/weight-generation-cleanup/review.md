# Review: Weight Generation Cleanup

**Reviewed:** 2026-03-02
**Reviewer:** Claude (Principal Engineer Review)
**Plan:** [plan.md](./plan.md)
**Commit:** `c608553`
**Verdict:** APPROVED WITH CHANGES

## Summary

This commit cleans up the weight generation flow for LLM-driven competitors: a cold-start path for first-time generation, corrected prompt text, a `competitor:add` CLI script, raw LLM output storage for debugging, and two database migrations. The implementation closely follows the plan, the new test coverage is solid, and the architecture is clean. One blocking issue: the `0006_snapshot.json` is a copy of `0005_snapshot.json` and is missing the `raw_llm_output` column, which will break future `drizzle-kit generate` runs.

## Findings

### Architecture & Design — Pass

- Implementation matches the plan across all 5 items (cold-start path, prompt fix, model ID migration, CLI script, API key guard).
- The cold-start branch in `src/competitors/weight-tuned/iteration.ts:126` is well-placed — the `if (!latestVersion)` check cleanly separates the two code paths.
- `add-competitor.ts` properly separates the testable logic (`parseAddCompetitorArgs`, `addCompetitor`) from the `main()` wiring, following the same pattern as `iterate.ts`.
- Domain boundaries respected — `iteration.ts` only imports types from infrastructure repos, not concrete implementations. The `WeightIterationDeps` type at line 16 provides clean dependency injection.
- Data flows in the correct direction: orchestrator script (`iterate.ts`) wires deps, passes to service (`iteration.ts`), which calls generator and repos.

### TypeScript & Type Safety — Concern

- **`as WeightConfig` in `generator.ts:77` and `generator.ts:100`**: Both `generateWeights` and `generateWithFeedback` parse the LLM JSON response and cast it directly to `WeightConfig` without Zod validation. The cast is technically safe because `iteration.ts:153` validates via `validateWeights()` before using the result, but the `GeneratedWeights.weights` field is typed as `WeightConfig` when it could be anything. If anyone consumes `generated.weights` before validation, they'll get a runtime surprise with no type error.
- The discriminated union pattern is used well for `WeightIterationResult` (`iteration.ts:27-29`) and `ValidationResult` (`validator.ts:7-9`).
- `WeightConfig` is correctly derived from Zod via `z.infer<>` (`types.ts:15`).

### Data Validation & Zod — Pass

- External LLM output is validated via `validateWeights()` in `iteration.ts:153`, which uses `weightConfigSchema.safeParse()` (`validator.ts:12`).
- The JSON schema is embedded in the system prompt (`generator.ts:42-44`) so LLMs see the expected structure.
- `stripMarkdownFences()` handles the common LLM failure mode of wrapping JSON in markdown code fences (`generator.ts:16-20`).
- `parseCurrentWeights()` in `iteration.ts:101-108` uses `safeParse` with a fallback to `DEFAULT_WEIGHTS` — good defensive pattern.

### Database & Drizzle ORM — Fail

- **`0006_snapshot.json` is identical to `0005_snapshot.json`** — both are missing the `raw_llm_output` column. The snapshot after migration 0006 should include the new column. Drizzle uses the latest snapshot to compute diffs for future migrations; a stale snapshot will cause `drizzle-kit generate` to either re-add the column or produce incorrect diffs. This must be fixed before any future migration is created.
- The migration SQL itself is correct: `ALTER TABLE competitor_versions ADD raw_llm_output text;` (`drizzle/0006_add-raw-llm-output.sql:2`).
- The schema definition correctly adds `rawLlmOutput: text("raw_llm_output")` as nullable (`schema.ts:84`).
- Migration 0005 (Gemini model ID update) is a safe data-only UPDATE, no schema change.
- `performanceSnapshot` is set to `null` when `stats.totalBets === 0` (`iteration.ts:168-178`), which is correct for a nullable JSON column.
- All queries are parameterised via Drizzle query builder.
- N+1 patterns exist in `buildLeaderboard()` (line 48: `getPerformanceStats` in a loop) and `buildRecentOutcomes()` (line 72: `markets.findById` in a loop). These are acceptable for now given the small number of competitors and predictions, but worth noting for future scale.

### Security — Pass

- No secrets or API keys are logged or exposed in error messages.
- The `OPENROUTER_API_KEY` guard in `iterate.ts:38-41` provides a clear fail-fast error instead of leaking the key in a cryptic API error.
- `add-competitor.ts` takes input from CLI args (trusted local user) — no injection risk.
- Raw LLM output stored in `raw_llm_output` column is just the model's text response — no secrets.

### Testing — Pass

- **Cold-start path**: Properly tested — `iteration.test.ts:125-133` verifies `generateWeights` is called (not `generateWithFeedback`) when no version exists.
- **Feedback path**: `iteration.test.ts:174-201` verifies the opposite — `generateWithFeedback` is called when a version exists.
- **Version numbering**: Tests cover both cold-start (version 1) and increment (version 3 → 4) paths.
- **Raw LLM output storage**: `iteration.test.ts:161-170` verifies the raw response is persisted.
- **add-competitor tests** (`add-competitor.test.ts`): Uses in-memory SQLite with full migrations (line 13-16), tests arg parsing, successful creation with correct defaults, and duplicate detection.
- **Generator tests**: Covers JSON parsing, markdown fence stripping, system prompt content, and error on invalid responses.
- **Feedback prompt tests**: Verifies the "TypeScript engine" text is gone and "weight configuration" is present.
- `as unknown as WeightIterationDeps["versionsRepo"]` casts in `iteration.test.ts` (lines 86-116) hide potential type mismatches between mocks and real repos. The mocks don't include `rawLlmOutput` on the findLatest return type, for example. Not blocking, but increases the chance of mocks drifting from the real API.

### Error Handling & Resilience — Pass

- `iterateCompetitor` wraps the entire flow in a try/catch (`iteration.ts:117-199`), returning a discriminated error result rather than throwing.
- Validation failure logs the raw LLM output for debugging (`iteration.ts:155`).
- `iterateAll` is resilient — one competitor failing doesn't block others (`iteration.ts:207-210`).
- `JSON.parse` in `generator.ts:77,100` can throw on invalid JSON. This is caught by the outer try/catch in `iterateCompetitor`. The raw response is available in the error log at line 155.
- `parseCurrentWeights` in `iteration.ts:101-108` handles `null`, `undefined`, and invalid JSON gracefully.

### Code Quality & Conventions — Pass

- Functions are small and focused. `parseAddCompetitorArgs` is a pure function, `addCompetitor` handles just the DB logic, `main()` wires everything.
- `stripMarkdownFences` is a well-named, single-purpose utility.
- The `WEIGHT_SYSTEM_PROMPT` embeds the JSON schema inline — good approach so the LLM sees the exact expected structure.
- `FeedbackPromptInput.currentCode` (`feedback.ts:29`) is a vestigial name from the code-generation era. The public API (`WeightFeedbackInput.currentWeights`) is correctly named, and `currentCode` is only used internally. Minor.
- No dead code or unused imports.

### Operational Concerns — Pass

- `strict: false` in `client.ts:40` is a deliberate change — the commit message explains JSON schema strict mode is incompatible with the flexible `signals` object (which uses `additionalProperties`). This is correct; OpenRouter/OpenAI strict mode requires all properties to be explicitly listed.
- The `competitor:add` script entry is added to `package.json`.
- Migrations are additive and safe for production (UPDATE for 0005, ALTER TABLE ADD for 0006).
- The `isMainModule` guard in `add-competitor.ts:100-108` prevents the script from running when imported by tests.

## What's Done Well

- Clean separation of cold-start vs feedback iteration paths — the branching logic in `iteration.ts:126-151` is easy to follow
- `stripMarkdownFences()` is a practical defense against LLM response formatting quirks, with thorough test coverage
- `add-competitor.ts` follows the project pattern of separating testable logic from wiring, making the tests straightforward
- The `add-competitor.test.ts` uses real in-memory SQLite with full migrations rather than mocks, giving high confidence the insert works with the actual schema
- Raw LLM output storage (`rawLlmOutput`) is a smart debugging addition — parse failures become diagnosable instead of opaque
- `performanceSnapshot` correctly set to `null` when no bets exist, avoiding meaningless all-zeros snapshots
- System prompt now embeds the full JSON schema so LLMs see the exact expected output structure
- Good test coverage overall — cold start, feedback path, version numbering, error cases, arg parsing, duplicate detection

## Must-Do Changes

These MUST be addressed before merging:

- [ ] **Fix `drizzle/meta/0006_snapshot.json`** — it's identical to `0005_snapshot.json` and is missing the `raw_llm_output` column in `competitor_versions`. Regenerate with `drizzle-kit generate` or manually add the column entry. Without this fix, future `drizzle-kit generate` runs will produce incorrect migration diffs.

## Should-Do Changes

Recommended but not blocking:

- [ ] **Validate LLM output with Zod in `generator.ts:77,100`** — replace `as WeightConfig` with `weightConfigSchema.parse()` or return `unknown` and let `validateWeights` handle it. The current flow works because validation happens downstream, but the type assertion lies to the type system about unvalidated data.
- [ ] **Rename `FeedbackPromptInput.currentCode` to `currentConfig`** in `feedback.ts:29` — vestigial naming from the code-generation era. Low priority since it's internal.

## Questions for the Author

- The plan item #6 noted `minEdge` and `kellyFraction` as dead parameters that the engine never reads. Was this intentionally deferred, or was it addressed separately?
