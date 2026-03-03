# Review: Add Prediction Confidence to Bet UI Rows

**Reviewed:** 2026-03-03
**Reviewer:** Claude (Principal Engineer Review)
**Plan:** `features/bet-confidence-ui/plan.md`
**Verdict:** APPROVED

## Summary

The goal was to surface the AI's prediction confidence in all three bet-display locations (Bets page, Competitor detail bets tab, Dashboard recent activity) without schema changes, by joining predictions to bets in the API layer via the composite key `(competitorId, marketId, side)`. The implementation matches the plan exactly — all ten tasks are complete, the join logic is correct and consistent across all three routes, and the UI displays the value cleanly with a null fallback. Code quality is high.

---

## Findings

### Architecture & Design — Pass

Implementation matches the plan exactly. The composite-key lookup (`competitorId:marketId:side`) is applied consistently in all three routes. Layer boundaries are respected — no domain imports added, no infrastructure reached from UI.

One good call: `competitors.ts` reuses the existing `predictions` variable (from the pre-existing `findByCompetitor` fetch) rather than adding a second query. `dashboard.ts` correctly adds `predictionsRepo.findAll()` inside the existing `Promise.all`. `bets.ts` makes one additional sequential query, which is consistent with how competitors and markets are already fetched in that route.

`$id.tsx` already imported `formatPct` before this change (line 20); no new import was needed. The `bets/index.tsx` and `recent-activity.tsx` correctly added the import.

### TypeScript & Type Safety — Pass

`BetSummary.confidence: number | null` (`src/shared/api-types.ts:119`) is correctly typed. The map lookup returns `number | undefined`; the `?? null` coercion normalises it to `number | null` consistently across all three routes. No non-null assertions introduced. No implicit `any` in production code.

The schema (`schema.ts:125`) confirms `confidence: real("confidence").notNull()` — so confidence is always a number when a prediction exists, and the `| null` on `BetSummary` only handles the "no matching prediction" case. Types match reality.

### Data Validation & Zod — Pass

No new external data boundaries introduced. Confidence comes from the `predictions` table via Drizzle (typed by the schema), not from any external API or user input. No new Zod validation needed.

### Database & Drizzle ORM — Pass

No schema changes, no migrations. All three new `findAll()` calls are parameterised via Drizzle's query builder. The `findByCompetitor` in `competitors.ts` is already scoped — no full table scan for the detail endpoint.

No N+1 patterns introduced. The lookup map approach (build once, access in O(1)) is the right pattern here.

**Minor:** `bets.ts` now runs 4 sequential DB round-trips (bets → competitors → markets → predictions). This was already 3 sequential calls before this change; it wasn't parallelised then and it still isn't. This is a pre-existing issue, not introduced here. See Should-Do.

### Security — Pass

No secrets, keys, or sensitive data touched. No new logging of wallet credentials. Read-only display change.

### Testing — Pass

The two new tests in `bets.test.ts` are well-structured: one tests the happy path (prediction found, confidence returned), one tests the null fallback (no predictions). Both are direct tests of the actual route behaviour.

`competitors.test.ts` and `dashboard.test.ts` each add one test verifying confidence is present in the respective response.

Existing tests that don't override `predictionsRepo` continue to work correctly because `createMockDeps` already defaults `predictionsRepo.findAll` to `async () => []` (`tests/unit/api/helpers.ts:46-53`) — these will return `confidence: null` for all bets, which those tests don't assert on.

**One gap:** No test verifies the side-mismatch case (prediction exists for `(c1, m1, NO)` but bet is `(c1, m1, YES)` → should return `null`). Also, the competitors and dashboard tests only cover the positive case; neither verifies the null fallback for those routes. See Should-Do.

### Error Handling & Resilience — Pass

No new error paths. The `Map.get()` → `?? null` chain is safe and cannot throw. No uncaught promise rejections introduced.

### Code Quality & Conventions — Pass

The composite key string `${p.competitorId}:${p.marketId}:${p.side}` is used identically in all three routes — consistent and readable. The map-then-lookup pattern is applied uniformly. No dead code, no unnecessary abstractions.

UI display (`b.confidence != null ? formatPct(b.confidence) : "—"`) matches existing null-display conventions in the project (consistent with how `profit` is handled in adjacent cells).

### Operational Concerns — Pass

No migrations required, so no deployment risk. The only operational delta is one additional `predictionsRepo.findAll()` call per `/bets` request and per `/dashboard` request. For a single-operator admin dashboard with a small predictions table, this is not a concern.

**If predictions grow large** (thousands of rows), `bets.ts` fetching all predictions for every request regardless of the active `competitorId` filter would become inefficient. This matches the existing pattern for competitors and markets, so it's an acceptable trade-off for now. See Should-Do.

---

## What's Done Well

- **Dashboard correctly parallelises** the new `predictionsRepo.findAll()` inside the existing `Promise.all` (`dashboard.ts:8-16`) — no new sequential latency on the most-viewed route.
- **Competitors route reuses the existing prediction fetch** (`competitors.ts:76-78`) — no extra DB query needed because `findByCompetitor` was already there.
- **Null handling is correct throughout** — `?? null` ensures `BetSummary.confidence` is always `number | null`, never `undefined`, matching the type exactly.
- **Test coverage hits the two most important cases** in `bets.test.ts`: match and no-match.
- **No schema changes or migration** — a clean display-only enrichment, as intended.
- **UI is consistent** — the "—" fallback and `formatPct` usage matches existing patterns in the table cells.

---

## Must-Do Changes

None.

---

## Should-Do Changes

- [x] **Add side-mismatch test in `bets.test.ts`**: Add a test where a prediction exists for `(c1, m1, "NO")` but the bet is `(c1, m1, "YES")`. Assert `confidence` is `null`. This verifies the composite key lookup doesn't accidentally match on partial keys.

- [x] **Add null-confidence fallback tests for competitors and dashboard routes**: `competitors.test.ts` and `dashboard.test.ts` currently only cover the positive case. A test with an empty `predictionsRepo.findAll` (or a mismatched prediction) would make the null path explicit for those routes too.

- [x] **Parallelise queries in `bets.ts`**: Lines 20-27 make three sequential awaits (competitors, markets, predictions) after the initial bets fetch. These are independent and could be wrapped in `Promise.all`. Pre-existing issue, but this change adds a 4th sequential call and is a good moment to clean it up.

- [x] **Scope the predictions fetch in `bets.ts` when filtering by competitorId**: When `competitorFilter` is set (line 16-18), the route still fetches all predictions. A `predictionsRepo.findByCompetitor(competitorFilter)` would reduce the result set significantly as data grows. Not urgent now, but worth noting for when the table is larger.

---

## Questions for the Author

- Is there a longer-term plan to add a `predictionId` FK to the `bets` table? The plan notes this as a deferred trade-off. If the system eventually allows re-runs or multiple predictions per (competitor, market, side), the composite-key lookup will silently return the wrong (last-inserted) confidence. A FK would make this explicit and queryable.
