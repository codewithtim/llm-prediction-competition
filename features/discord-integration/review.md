# Review: Discord Notification System

**Reviewed:** 2026-03-04
**Reviewer:** Claude (Principal Engineer Review)
**Plan:** features/discord-integration/plan.md
**Verdict:** APPROVED WITH CHANGES

## Summary

The feature adds a well-architected generic notification system with a Discord adapter. The implementation closely follows the plan, with a good separation between domain types, notification service, and platform-specific adapters. The code is clean, well-tested, and follows existing project conventions. There are two blocking issues (missing validation at a trust boundary, and a missing test for the CLI script) and a few minor improvements.

## Findings

### Architecture & Design — Pass

The layering is correct and clean:
- Domain types live in `src/domain/types/notification.ts` — no infrastructure imports
- The notification service in `src/domain/services/notification.ts` depends only on the repo type and domain types
- The Discord adapter lives in `src/apis/notifications/adapters/discord.ts` — correct placement in the infrastructure layer
- The `adapter-registry.ts` is a nice addition (not in the original plan) that eliminates duplicate adapter map construction
- Data flows correctly: orchestrator → service → adapter → external API

The `bets_failed` event type was added beyond the original plan scope. This is a sensible addition — failed bet notifications are arguably more important than successful ones for operational awareness.

The `FailedBetDetail` and `PlacedBetDetail` types in the prediction pipeline are structurally similar to `FailedBetNotification` and `PlacedBetNotification` in the domain types, but this is intentional — the pipeline types carry extra fields (`marketId`, `fixtureId`) needed for logging/pipeline tracking, while the notification types are trimmed for the notification boundary. The scheduler maps between them. This is the right separation.

### TypeScript & Type Safety — Pass

- All types are well-defined with discriminated unions (`NotificationEvent`)
- The `formatEvent` switch is exhaustive over all event types
- `SettledBet.marketQuestion` is properly threaded through the settlement service
- The `failedBase` spread pattern in `prediction-pipeline.ts:469-477` is clean and type-safe
- `sendNotification` in `scheduler.ts:38` uses proper optional chaining on `notificationService?.notify(event)`

Minor note: `as unknown as typeof fetch` casts in tests (`discord.test.ts:24,44`) are acceptable — Bun's `mock()` return type doesn't perfectly match `globalThis.fetch`, and this is a test-only pattern used consistently elsewhere in the project.

### Data Validation & Zod — Concern

**`src/scripts/add-notification-channel.ts:64`** — `JSON.parse(configStr)` parses CLI input into `Record<string, string>` without validation. The parsed result is typed as `Record<string, string>` but `JSON.parse` returns `any`, so a user passing `{"webhookUrl": 123}` or `[1,2,3]` would silently create a channel with the wrong config shape. This is a CLI script (internal tool), so the blast radius is small, but it should at minimum validate the parsed JSON is a plain object with string values, or use a Zod schema.

**`src/domain/services/notification.ts:21`** — `channel.config as Record<string, string>` is a type assertion on data coming from the database. The `config` column is declared as `text("config", { mode: "json" }).$type<Record<string, string>>()` in the schema, so Drizzle will parse it as JSON, but the DB could contain anything if inserted manually. The assertion is consistent with how other JSON columns are used in this codebase, so this is acceptable.

### Database & Drizzle ORM — Pass

- Migration `0015_milky_robin_chapel.sql` is additive (CREATE TABLE only) — safe to apply
- The `notification_channels` table uses correct SQLite patterns: `integer` for boolean with mode, `integer` for timestamps with mode, `text` for JSON with mode
- Repository uses parameterised queries via Drizzle's builder — no raw SQL
- The `update` method correctly sets `updatedAt: new Date()` on every update
- No N+1 patterns — `findEnabled()` is a single query

### Security — Pass

- Webhook URLs are stored in the database `config` column, not in env vars — documented in the plan as a deliberate design choice
- Webhook URLs are not logged (the `logger.error` calls in `discord.ts:157,161` log status codes and error messages, not the URL)
- No secrets are exposed in notification payloads sent to Discord
- The `add-notification-channel.ts` script uses dynamic imports to avoid loading env vars until needed — follows existing script patterns

### Testing — Concern

Good coverage overall:
- Discord adapter: 7 tests covering all event types, HTTP errors, network errors, and missing config
- Notification service: 4 tests covering multi-channel dispatch, unknown adapters, one-channel-failing, and no-channels
- Repository: 4 tests using in-memory SQLite with full migrations — follows project conventions
- Existing tests extended: settlement test verifies `marketQuestion`, pipeline test verifies `placedBetDetails`

**Missing:**
- `src/scripts/add-notification-channel.ts` has exported `parseArgs` and `runCommand` functions but no unit tests. The project has a precedent for testing scripts (`tests/unit/scripts/add-competitor.test.ts` exists). The `parseArgs` function has non-trivial logic (multiple arg formats, JSON parsing, NaN checks) that should be tested.
- No test for the `failedBetDetails` population in the pipeline — only `placedBetDetails` is tested. A failed bet path test would catch regressions in the `failedBase` spread pattern.
- Scheduler tests don't verify that `sendNotification` is called after prediction/settlement runs with non-empty results. The existing scheduler tests are minimal (happy path + error handling), so this is consistent but still a gap.

### Error Handling & Resilience — Pass

- Discord adapter catches both HTTP errors and network errors — neither throws (`discord.ts:149-162`)
- Notification service catches per-channel errors so one failing channel doesn't block others (`notification.ts:22-31`)
- `Promise.allSettled` in `notification.ts:14` ensures all channels are attempted regardless of individual failures
- Scheduler uses fire-and-forget with `.catch()` — notification failures never block the scheduler cycle
- Error messages include relevant context (channel name, type, status code)

### Code Quality & Conventions — Pass

- Naming is clear and consistent: `createDiscordAdapter`, `createNotificationService`, `notificationChannelsRepo`
- The `sendNotification` helper in `scheduler.ts:38-43` cleanly deduplicates the three notification blocks
- `failedBase` in `prediction-pipeline.ts:469` eliminates triplicated object construction
- No dead code, no commented-out code, no unused imports
- The `adapter-registry.ts` is a focused module with a single responsibility
- File placement follows project conventions exactly

### Operational Concerns — Pass

- Logging: Discord adapter logs HTTP failures with status code and detail (`discord.ts:157`). Notification service logs unknown adapter types and send failures with channel name and type.
- Scheduler notification failures are logged at `warn` level — appropriate since notifications are non-critical
- Migration is additive — safe to deploy without downtime
- `notificationService` is optional in `SchedulerDeps` — existing deployments without notification config continue working
- No unbounded loops — the pipeline bet detail arrays are bounded by the number of bets in a single run

## What's Done Well

- **Clean adapter pattern** — Adding a new notification platform (Slack, email) requires only a new adapter file and a registry entry. No changes to the service or domain types needed.
- **Fire-and-forget with proper error boundaries** — Notifications never block or crash the core betting pipeline. Every error boundary is correctly placed.
- **`adapter-registry.ts`** — Good refactoring to eliminate the duplicate `new Map([["discord", ...]])` in `index.ts` and `iterate.ts`.
- **`failedBase` spread pattern** (`prediction-pipeline.ts:469-477`) — Clean deduplication of the 7 shared fields across 3 push sites.
- **`sendNotification` helper** (`scheduler.ts:38-43`) — Eliminated 3 identical `.catch()` blocks.
- **`Promise.allSettled`** in notification service — Channels are notified in parallel, and individual failures are isolated.
- **DB-managed channels** — Supports multiple channels, enable/disable without redeploy, and future API/UI management. Good trade-off vs. env vars.
- **Repository tests use real migrations** — `notification-channels.test.ts` uses in-memory SQLite with full migration, not partial mocks. This catches schema mismatches.

## Must-Do Changes

- [ ] **Add `parseArgs` unit tests for `add-notification-channel.ts`** — The function handles 4 arg formats with JSON parsing, NaN checks, and missing-arg fallthrough. This is non-trivial logic with no test coverage. Create `tests/unit/scripts/add-notification-channel.test.ts` following the pattern in `tests/unit/scripts/add-competitor.test.ts`.
- [ ] **Validate `JSON.parse` result in `add-notification-channel.ts:62-67`** — The parsed config is typed as `Record<string, string>` but could be any JSON value. Add a runtime check that the result is a plain object with string values, or use a Zod schema like `z.record(z.string())`.

## Should-Do Changes

- [ ] Add a test for `failedBetDetails` population in `pipeline.test.ts` — verify the array is populated when `bettingService.placeBet` returns `{ status: "failed" }` or throws
- [ ] Consider adding a test in `scheduler.test.ts` that verifies `notificationService.notify` is called after a prediction run with placed bets — would catch regressions if the notification wiring is accidentally removed

## Questions for the Author

None — the implementation cleanly follows the plan with sensible additions (bets_failed event, adapter-registry extraction).
