# Review: Fixture Scheduling — Weekly Discovery, Status Tracking, and Prediction Lead Time

**Reviewed:** 2026-03-03
**Reviewer:** Claude (Principal Engineer Review)
**Plan:** [features/fixture-scheduling/plan.md](plan.md)
**Verdict:** APPROVED

## Summary

This feature restructures the scheduling into three independent concerns: weekly discovery, targeted fixture status updates, and kickoff-aware prediction timing. The implementation follows the plan precisely, introduces a clean `FixtureStatusPipeline`, adds three new repository methods with proper ISO string handling for SQLite date comparisons, and wires everything through the scheduler with the established overlap-prevention pattern. Code quality is high, test coverage is thorough (18 new tests across 3 files), and all 524 tests pass with clean TypeScript compilation.

## Findings

### Architecture & Design — Pass

The implementation matches the plan precisely. Each change is in the right file:
- Config additions in `src/orchestrator/config.ts:29-30,52-56`
- Repository methods in `src/infrastructure/database/repositories/fixtures.ts:60-95`
- New pipeline in `src/orchestrator/fixture-status-pipeline.ts` (orchestrator layer, correct)
- Scheduler wiring in `src/orchestrator/scheduler.ts:14,25,34,43,133-159,267-269,312-315`
- Entry point wiring in `src/index.ts:27,146-149,155`

The `FixtureStatusPipeline` follows the exact same factory pattern as `DiscoveryPipeline` and `PredictionPipeline` — deps type, factory function, result type, exported type alias. No new abstractions, no over-engineering.

Domain boundaries are clean. The fixture status pipeline uses the orchestrator layer to wire infrastructure (FootballClient, fixturesRepo) with a mapper from the infrastructure layer (`mapFixtureStatus`). No domain layer violations.

### TypeScript & Type Safety — Pass

- `FixtureStatusPipelineResult` at `fixture-status-pipeline.ts:6-10` is a clean type — no `any`, no optional ambiguity
- `FixtureStatusPipelineDeps` at `fixture-status-pipeline.ts:12-15` uses the same `ReturnType<typeof fixturesRepoFactory>` pattern as other pipelines
- The `updateStatus` method at `fixtures.ts:86-94` uses a union literal type for the status parameter, matching the Drizzle schema enum exactly
- `findReadyForPrediction` at `fixtures.ts:60` accepts `number` — clean, no implicit any
- No type assertions in production code. The `as never` casts in tests at `fixture-status-pipeline.test.ts:98,115,136,157,181` are a known project convention for partial mock repos

### Data Validation & Zod — Pass

No new external data boundaries introduced. The `mapFixtureStatus()` function (pre-existing, well-tested with 15+ status codes in `mappers.test.ts:104-141`) handles the API response mapping, including a safe default to `"scheduled"` for unknown status codes. The `getFixtures` response shape is validated by existing infrastructure.

### Database & Drizzle ORM — Pass

- All queries use Drizzle's query builder with parameterised values — no string interpolation
- `toISONoMs()` at `fixtures.ts:5-7` correctly normalises `Date.toISOString()` (which includes `.000Z`) to match the stored format (no milliseconds). This is essential because SQLite compares these as strings lexicographically.
- `findReadyForPrediction` at `fixtures.ts:60-70` correctly filters: `status = 'scheduled' AND date <= cutoff AND date > now`
- `findNeedingStatusUpdate` at `fixtures.ts:72-84` correctly finds: `(status = 'scheduled' AND date <= now) OR status = 'in_progress'`
- `updateStatus` at `fixtures.ts:86-94` correctly sets `updatedAt: new Date()` alongside the status change
- No N+1 concerns — the status pipeline does one `findNeedingStatusUpdate()` query then individual fixture lookups via the external API (not DB)
- No schema/migration changes — all changes use existing columns. Backwards compatible.

### Security — Pass

No secrets involved in this feature. Fixture IDs and statuses are public data. No user input in the new query paths — `leadTimeMs` is from config, and `id` is from DB rows.

### Testing — Pass

Excellent coverage — all 9 planned repository tests implemented (`fixtures.test.ts:75-171`), all 5 planned pipeline tests implemented (`fixture-status-pipeline.test.ts:103-212`), scheduler wiring tests added (`scheduler.test.ts:335-387`), and prediction pipeline updated (`pipeline.test.ts:1258-1271`).

**Repository tests** use in-memory SQLite with full migrations — the gold standard for this project. Time-sensitive tests use `futureDate()` and `pastDate()` helpers that compute relative to `Date.now()`, avoiding flaky fixed-date tests.

**Pipeline tests** cover all critical paths:
- `1H` → `in_progress` transition (`fixture-status-pipeline.test.ts:104-123`)
- `FT` → `finished` transition (`fixture-status-pipeline.test.ts:125-144`)
- No-op when status unchanged (`fixture-status-pipeline.test.ts:146-165`)
- Graceful error handling with continuation (`fixture-status-pipeline.test.ts:167-191`)
- Empty API response handling (`fixture-status-pipeline.test.ts:193-211`)

**Scheduler tests** verify the fixture status pipeline runs immediately, has overlap prevention, and timer cleanup on `stop()`.

**Prediction pipeline test** at `pipeline.test.ts:1259-1271` verifies `findReadyForPrediction` is called with the config's `predictionLeadTimeMs` — confirming the wiring change.

One minor note: the repo test at `fixtures.test.ts:168` uses `after!.updatedAt.getTime()` — a non-null assertion. This is acceptable in a test where the preceding `upsert` guarantees the row exists.

### Error Handling & Resilience — Pass

The fixture status pipeline at `fixture-status-pipeline.ts:31-57` handles errors per-fixture with try/catch, ensuring one failed API call doesn't abort the batch. Error messages include the fixture ID for debugging. Empty API responses are handled gracefully at line 35-38 with a warning log.

The scheduler's `runFixtureStatus()` at `scheduler.ts:133-159` follows the identical pattern used by `runDiscovery`, `runPredictions`, and `runSettlement` — overlap guard, try/catch with structured logging, always-reset in `finally`.

### Code Quality & Conventions — Pass

- Naming is consistent: `fixtureStatusPipeline`, `runFixtureStatus`, `fixtureStatusRunning`, `fixtureStatusTimer` — follows the exact pattern of other pipelines
- `toISONoMs` at `fixtures.ts:5-7` is a small, focused helper with a clear name
- No dead code, no unused imports
- The `start()` method at `scheduler.ts:267-269` runs fixture status immediately without delay support — matches the plan (no delay needed for this lightweight pipeline)
- Config comments at `config.ts:52-56` document the values clearly

### Operational Concerns — Pass

- Structured logging throughout: `fixture-status-pipeline.ts:29,36,47,56,60-64` all use `logger.info/warn/error` with structured fields
- Log messages include counts (`fixturesChecked`, `statusesUpdated`) and IDs (`fixtureId`) — actionable in production
- The fixture status pipeline only issues one API call per fixture that needs updating — minimal API consumption
- `discoveryIntervalMs: 7 * 24 * 60 * 60 * 1000` (weekly) dramatically reduces API-Football and Polymarket API usage
- `predictionIntervalMs: 15 * 60 * 1000` (15 min) with `predictionLeadTimeMs: 30 * 60 * 1000` means the pipeline runs frequently but processes very few fixtures per run — only those within 30 minutes of kickoff
- `fixtureLookAheadDays: 14` provides a full week of buffer for weekly discovery
- Graceful shutdown: `stop()` at `scheduler.ts:312-315` clears `fixtureStatusTimer`

## What's Done Well

- **Exact plan adherence** — every task in the plan's checklist is implemented precisely as described. No scope creep, no deviations.
- **`toISONoMs` helper** (`fixtures.ts:5-7`) — correctly handles the SQLite string comparison gotcha where `Date.toISOString()` includes milliseconds but stored dates don't. This prevents subtle bugs where `"2026-03-05T20:00:00.000Z" > "2026-03-05T20:00:00Z"` would be true but shouldn't be.
- **Repository tests with real SQLite** (`fixtures.test.ts:75-171`) — using in-memory DB with full migrations means these tests validate real SQL behavior, not just mock expectations. The time-relative `futureDate/pastDate` helpers are clean.
- **Per-fixture error isolation** (`fixture-status-pipeline.ts:53-57`) — one API failure doesn't abort the batch, matching the resilience pattern established by the prediction pipeline.
- **Scheduler consistency** — the new pipeline follows the exact same timer/guard/logging pattern as the other 5 scheduled tasks. No special-casing.
- **Comprehensive mock fixture repo update** (`pipeline.test.ts:386-388`) — the mock repo was updated to include all three new methods, ensuring existing tests continue to work with the expanded repo surface.

## Must-Do Changes

None. The implementation is clean, well-tested, and follows established patterns.

## Should-Do Changes

- [ ] **Consider adding an index on `(status, date)` to `fixtures` table** — `findReadyForPrediction` and `findNeedingStatusUpdate` both filter on `status` + `date`. With the current fixture count (dozens), this is irrelevant, but if the table grows to thousands of rows, an index would help. Low priority — add when needed.

## Questions for the Author

None — the implementation matches the plan and the design decisions are well-reasoned in the plan document.
