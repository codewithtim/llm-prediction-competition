# Review: Football Stats Enrichment

**Reviewed:** 2026-03-03
**Reviewer:** Claude (Principal Engineer Review)
**Plan:** `features/football-stats-enrichment/plan.md`
**Verdict:** APPROVED WITH CHANGES

## Summary

The feature enriches the prediction pipeline with three new API-Football data sources (injuries, team season stats, player season stats), adds a 24h cache layer for the expensive paginated endpoints, and introduces three new weight-tuned feature extractors. The implementation closely follows the plan and is structurally sound — layering, repository pattern, and graceful degradation are all correct. There are two must-do items: an unsafe type assertion in the mapper that bypasses TypeScript's verification of the enriched data shape, and missing unit tests for `summarisePlayerStats` which contains meaningful business logic.

---

## Findings

### Architecture & Design — Pass

Implementation matches the plan exactly. Domain layer (`statistics.ts`) contains only Zod schemas and type exports with no infrastructure imports. Infrastructure depends on domain types. The orchestrator wires everything correctly. Pagination is correctly encapsulated in `getAllPlayers` at the client layer — the pipeline calls one method and receives a full list. `statsCacheRepo` is correctly added to `PredictionPipelineDeps` and wired up in `src/index.ts`. Repository pattern is followed throughout; all repos take `db` via DI.

One minor structural note: the home and away stats fetches (team stats + player stats = 4 sequential try/catch blocks) are done one at a time. These could be parallelised with `Promise.all`, but this is a performance concern rather than a correctness issue and the plan doesn't require it.

### TypeScript & Type Safety — Concern

**The main issue**: `mapMinuteStats` (`mappers.ts:148-154`) returns `Record<string, { total: number | null; percentage: string | null }>` and `mapUnderOver` (`mappers.ts:158-161`) returns `Record<string, { over: number; under: number }>`. Both return open record types rather than the specific keyed types from `goalsByMinuteSchema` / `underOverSchema`. This forces the `as TeamSeasonStats` cast at `mappers.ts:181` — TypeScript cannot verify the mapped fields actually satisfy the schema. A future change to either schema would not be caught at compile time.

The plan explicitly proposed return types of `z.infer<typeof goalsByMinuteSchema>` and `z.infer<typeof underOverSchema>` for the two helpers. The implementation chose `Record<string, ...>` instead, requiring the assertion to paper over the gap. The fix is to give the helpers their exact return types (using `as const` on the interval arrays with proper generic inference, or `Object.fromEntries` with explicit typing).

**Other items (minor)**:
- `pipeline.test.ts:176`: `getTeamStatistics: mock(() => Promise.resolve(apiResponse({} as never)))` — `as never` used to force a wrong type. When this mock is called (on cache miss in most tests), `mapApiTeamStatistics({})` is attempted and caught silently, meaning tests that hit the uncached path don't actually verify the enrichment path works — they just verify it fails gracefully.
- `pipeline.test.ts:195+` (registry mock): `as unknown as CompetitorRegistry` — standard mock pattern, acceptable.

### Data Validation & Zod — Pass

Zod schemas are defined in the domain layer and types are derived with `z.infer<>` — no manual type duplication. The optional enrichment fields on `statisticsSchema` are correct; existing engines continue to work unchanged. The `injurySchema` correctly uses `z.string()` for `type` rather than a restrictive enum, matching the plan's explicit decision.

The existing pattern of not Zod-validating raw API responses at the client boundary (`res.json()` with no `.parse()`) is pre-existing and applies to the new endpoints too. Not introduced by this feature.

### Database & Drizzle ORM — Pass

Two cache tables added correctly. The composite key `"${teamId}-${leagueId}-${season}"` is constructed consistently in both `get` and `set`. `onConflictDoUpdate` upserts are correct. Migration `0010_wakeful_black_cat.sql` is additive (new tables only). No foreign keys on cache tables — correct, they're ephemeral. No N+1 patterns. Single-table writes, no transactions needed. SQLite types are correct (`integer` for timestamps with `mode: "timestamp"`, `text` for JSON).

No indexes added on `team_id` / `league_id` / `season` columns — but since all lookups go through the primary key (the composite text `id`), this is fine.

### Security — Pass

No secrets, API keys, or credentials are logged or exposed. The API key is passed only in the `x-apisports-key` header and never surfaces in error messages or log statements. No new environment variable access patterns. No user input flows into the new query paths.

### Testing — Concern

Overall test coverage is good — client, mapper, cache repository, features, and pipeline graceful-degradation paths are all tested. The mapper tests in particular are thorough and use realistic factory data. However there are specific gaps:

**Must-fix gap — `summarisePlayerStats` is untested**. This function at `prediction-pipeline.ts:124-137` contains meaningful business logic: sort by rating descending, take top 8, then scan the full list to add fixture-specific injured players not already in the top 8. The edge cases (empty input, all players injured, injured player already in top 8, rating ties) are untested. The plan's test matrix didn't explicitly call this out, but it's the kind of logic that regresses silently.

**Must-fix gap — no pipeline test verifies enrichment data reaches the engine**. All pipeline tests confirm that `fixturesProcessed` and `predictionsGenerated` are correct, but none assert that the `Statistics` object passed to the engine actually contains the enrichment fields. The plan specified tests like "enriched statistics include injuries when API call succeeds" and "enriched statistics include homeTeamSeasonStats when cached" — these would require capturing the argument passed to the engine mock. Without them, it's possible to break the field-assignment step (`statistics: { ... injuries, homeTeamSeasonStats, ... }`) silently.

**Sloppy mock in pipeline tests**: `"uses cached team stats when available"` at `pipeline.test.ts:843-858` mocks `getTeamStats` returning `{ goalsForByMinute: {}, goalsAgainstByMinute: {}, goalsForUnderOver: {}, goalsAgainstUnderOver: {} }` — these don't conform to `TeamSeasonStats` (missing all 8 required minute-interval keys). The `as unknown as PredictionPipelineDeps["statsCache"]` cast hides this. The test still passes because the cached value is just passed through to the statistics object, but it's a false type guarantee.

**Minor gap**: `scoringConsistency` tests are missing the "returns 0.5 when no season stats" case (present for `cleanSheetDiff` at line 307 but not for `scoringConsistency`).

**Good**: The `"ignores Questionable players"` test for `injuryImpact` at line 291 correctly verifies the `type === "Missing Fixture"` filter, which is the most important semantic property of that feature extractor.

### Error Handling & Resilience — Pass

All four new API calls (injuries, home team stats, away team stats, home/away players) are individually wrapped in try/catch with structured `logger.warn` calls that include `fixtureId` and `error` context. An error in one fetch doesn't affect others. The pipeline continues and generates predictions even when all enrichment fails. Injuries default to `[]` (not `undefined`) which is intentional — the feature extractors check `stats.injuries?.length` and handle the absent case. Season stats and player stats default to `undefined` when fetch fails, which is correct for the optional schema fields.

### Code Quality & Conventions — Concern

**`src/index.ts:195`**: There's a stray `// test` comment at the very end of the file. Leftover debug artifact, should be removed.

**`mappers.ts:181`**: `} as TeamSeasonStats;` — see TypeScript section above. The cast is needed because the helpers return open record types, but it's the wrong solution.

**`summarisePlayerStats` inner loop**: Uses `.find()` inside a `for...of` loop (`top.find(p => p.playerId === ...)`) which is O(n²) over the injured-player scan. For the expected set sizes (top 8 + handful of injured players) this is harmless. Could use a `Set` of top player IDs for O(1) lookup, but not worth refactoring.

**Naming is consistent** throughout: `getTeamStats`/`setTeamStats`, `getPlayerStats`/`setPlayerStats`, `mapApiInjuries`, `mapApiTeamStatistics`, `mapApiPlayerToPlayerStats`. Clear and follows existing conventions.

**`getAllPlayers`**: No maximum page guard. If the API reports an unexpectedly large `paging.total`, the loop runs unchecked. Acceptable for a paid API plan with a known dataset (football players), but worth noting.

### Operational Concerns — Pass

The `date` parameter is correctly passed to `getTeamStatistics` at `prediction-pipeline.ts:310` and `342`, preventing stats from including matches played after the fixture being predicted (data leakage prevention — the plan's most important correctness decision). Cache TTL is 24h, consistent with the API's twice-daily update frequency for team stats.

Logging includes `fixtureId` in all warning paths. The scheduler entry point in `src/index.ts` correctly instantiates `statsCacheRepo(db)` and passes it to `createPredictionPipeline`. Migration is additive — no breaking changes for the running system.

---

## What's Done Well

- **Plan fidelity**: Every task in the plan is implemented. The trade-off decisions (cache tier-1 data, fetch injuries fresh, pass `date` param to prevent data leakage) are all honoured.
- **Graceful degradation**: Four separate try/catch blocks mean a failure in one enrichment source doesn't cascade. Engines receive partial or no enrichment rather than failing entirely.
- **Pagination encapsulation**: `getAllPlayers` handles all pagination internally at the client layer. The pipeline calls one method and gets a flat list — exactly as the plan specified.
- **Mapper test coverage**: `mappers.test.ts` is comprehensive with realistic factory builders, tests for missing-key defaults in `mapMinuteStats` and `mapUnderOver`, and correct handling of null `rating`/`appearances`.
- **Cache repository tests**: Use real in-memory SQLite with full migrations — correct pattern for repo tests. Covers null hit, stale hit, fresh hit, and upsert semantics for both table types.
- **`injuryImpact` test**: Correctly verifies the "Questionable" type is not counted — this is the most important semantic property of the feature extractor, and it's directly tested.
- **`DEFAULT_WEIGHTS` and `WEIGHT_JSON_SCHEMA`**: New signals default to `0.0` so existing competitors are unaffected, and the schema description string is updated so LLMs generating weight configs are aware of the new signals.
- **Data leakage prevention comment**: The inline comment at `prediction-pipeline.ts:310` explaining why `fixture.date` is passed is clear and correctly documents a non-obvious correctness decision.

---

## Must-Do Changes

- [ ] **`src/infrastructure/sports-data/mappers.ts:148-181`** — Fix `mapMinuteStats` and `mapUnderOver` to return their specific keyed types (`z.infer<typeof goalsByMinuteSchema>` and `z.infer<typeof underOverSchema>`) rather than open `Record<string, ...>`. This removes the need for the `as TeamSeasonStats` assertion at line 181 and lets TypeScript verify the mapper output satisfies the schema. The simplest fix: type the `Object.fromEntries` return with `as z.infer<typeof goalsByMinuteSchema>` on the inner expression (scoping the cast to the right level) or use explicit type annotations on the return.

- [ ] **Add unit tests for `summarisePlayerStats`** — Extract the function (currently unexported from `prediction-pipeline.ts`) or test it via a thin wrapper. Required cases: empty player list, rated players are top-8 by rating, an injured player outside top-8 is appended, an injured player already in top-8 is not duplicated, empty injuries list works correctly. This is business logic that can silently regress.

- [ ] **Add pipeline test that verifies enrichment reaches the engine** — At minimum one test should capture the `Statistics` argument passed to the engine mock and assert that `statistics.injuries` is an array, `statistics.homeTeamSeasonStats` is defined when cache returns data, etc. This validates the assignment block at `prediction-pipeline.ts:431-443` rather than just the side-effects (predictions count).

- [ ] **`src/index.ts:195`** — Remove the stray `// test` comment.

---

## Should-Do Changes

- [ ] **`tests/unit/orchestrator/pipeline.test.ts:176`** — Replace `getTeamStatistics: mock(() => Promise.resolve(apiResponse({} as never)))` with a mock that either returns a valid `ApiTeamStatisticsResponse` fixture or configure most tests to use the cache (returning a valid `TeamSeasonStats`). The `as never` means tests that hit the uncached path silently swallow the mapper crash, giving false confidence.

- [ ] **`tests/unit/orchestrator/pipeline.test.ts:843-858`** — Make the cached `TeamSeasonStats` mock value conform to the actual type (fill in all 8 minute interval keys and all 5 under/over keys). The current empty objects pass the `as unknown as` cast but don't match the schema.

- [ ] **Add `scoringConsistency` missing-data test** — "returns 0.5 when no season stats" is tested for `cleanSheetDiff` but not for `scoringConsistency`. Add the symmetric case.

- [ ] **`getAllPlayers` max page guard** — Add a safety cap (e.g. `while (page <= totalPages && page <= 10)`) to prevent an unbounded loop if the API returns an unexpectedly large `paging.total`. Low risk for a known football dataset but cheap to add.

- [ ] **Parallelise home/away enrichment fetches** — The four sequential try/catch blocks for home team stats, away team stats, home player stats, away player stats could use `Promise.allSettled` to halve wall-clock time on cache misses. Not urgent given the 24h cache means misses are rare in steady state.

---

## Questions for the Author

- **`getAllPlayers` league param**: `getAllPlayers(teamId, season)` fetches players without a `leagueId`, returning stats for all leagues. Players are then filtered by `fixture.league.id` in `mapApiPlayerToPlayerStats`. Is it possible for a player on a Premier League team to only have stats in a cup competition (`league.id` ≠ 39), making them disappear from the player list? If so, filtering at the cache-store level (before calling `setPlayerStats`) would under-count the squad. Consider storing all players (including multi-league) and filtering at display time only.

- **`form` field on `teamSeasonStatsSchema`**: The plan includes a prominent note distinguishing `teamSeasonStatsSchema.form` (whole-season form string from `/teams/statistics`) from `teamStatsSchema.form` (recent-form from standings). Is this distinction documented anywhere for the LLM engines that will consume both fields in the `Statistics` object? If the engines treat both as equivalent recent-form signals, the whole-season field could produce misleading reasoning early in the season.
