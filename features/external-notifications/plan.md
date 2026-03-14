# Plan: External Notifications — Twitter/X, Discord Enhancements & Weekly Summaries

**Date:** 2026-03-14
**Status:** Complete

---

## Overview

Extend the existing notification system (currently Discord-only, real-time events) to support Twitter/X posting and scheduled weekly summaries. The foundation is solid — `NotificationAdapter`, `AdapterFactory`, DB-driven channel config, and scheduler integration all exist. This plan adds a Twitter/X adapter, a new `weekly_summary` event type, and a scheduled summary pipeline that aggregates betting performance data.

---

## Approach

Build on the existing adapter pattern rather than introducing a new notification architecture. Three workstreams:

1. **Twitter/X adapter** — new adapter using the Twitter API v2 (OAuth 1.0a user context for posting tweets). Formats the same `NotificationEvent` types as plain-text tweets with key stats.

2. **Weekly summary event** — new `NotificationEvent` variant (`weekly_summary`) with aggregated stats: total bets, win rate, P&L, top competitor, upcoming fixtures. Both Discord and Twitter adapters handle this event type.

3. **Summary pipeline + scheduler job** — a new pipeline that queries the DB for the past 7 days of bets/settlements, builds the summary payload, and dispatches it through the notification service. Runs weekly on a `setInterval` like other pipelines.

**Why not a third-party service (e.g. Zapier, n8n)?**
Keeps everything in-process, testable, and consistent with the existing pattern. No external orchestration dependency. The adapter pattern already handles multi-channel dispatch.

### Trade-offs

- **Twitter API rate limits** — free tier allows 1,500 tweets/month (~50/day). With bets placed, settlements, and weekly summaries tweeted, high-volume days could eat into the budget. Acceptable for now — we can add event filtering later if needed.
- **OAuth 1.0a complexity** — Twitter v2 posting requires signing each request with consumer key/secret + access token/secret (4 credentials). Stored as env vars in `src/shared/env.ts`, consistent with how other API keys (sports data, OpenRouter) are managed.
- **Character limits** — tweets are 280 chars. Multi-bet events need concise formatting. For batches with many bets, we'll summarise counts rather than listing each bet individually.
- **No retry queue** — failed notifications are logged but not retried (existing behavior). Acceptable for social posting — stale notifications have diminishing value.

---

## Changes Required

### `src/domain/types/notification.ts`

Add `weekly_summary` event type and per-channel event filtering type.

```typescript
export type WeeklySummaryNotification = {
  periodStart: string; // ISO date
  periodEnd: string;   // ISO date
  totalBetsPlaced: number;
  totalBetsSettled: number;
  wins: number;
  losses: number;
  winRate: number;     // 0-1
  totalStaked: number;
  netPnl: number;
  topCompetitor: { id: string; name: string; pnl: number } | null;
  upcomingFixtures: number;
};

// Add to NotificationEvent union:
| { type: "weekly_summary"; summary: WeeklySummaryNotification }

// Event filtering — adapters can declare which events they handle
export type NotificationEventType = NotificationEvent["type"];
```

### `src/apis/notifications/adapters/twitter.ts` (new file)

Twitter/X adapter using OAuth 1.0a signing for the `POST /2/tweets` endpoint. Credentials come from env vars, not the DB channel config.

```typescript
import { env } from "../../../shared/env.ts";
import type { NotificationAdapter, NotificationEvent } from "../../../domain/types/notification.ts";

export function createTwitterAdapter(_config: Record<string, string>): NotificationAdapter {
  const { TWITTER_CONSUMER_KEY, TWITTER_CONSUMER_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET } = env;
  // Validate all 4 credentials present

  return {
    async send(event: NotificationEvent): Promise<void> {
      const text = formatTweet(event);
      if (!text) return; // Skip iteration_complete (internal-only)

      // OAuth 1.0a signed POST to https://api.twitter.com/2/tweets
      // Body: { text }
    },
  };
}
```

**Three event types are tweeted** (failed bets and iteration updates are skipped — only successful placements, outcomes, and summaries):

| Event | Tweet template |
|-------|---------------|
| `bets_placed` | `"🎯 New bet placed!\n\n{fixtureLabel}\n{marketQuestion}\n\n{side} @ {price} — ${amount} stake\nModel: {competitorId}"` |
| `bets_settled` | `"✅ Bet won!\n\n{marketQuestion}\n{side} — +${profit}\nModel: {competitorId}"` or `"❌ Bet lost.\n\n{marketQuestion}\n{side} — -${amount}\nModel: {competitorId}"` |
| `weekly_summary` | `"📊 Weekly Update\n\n{totalBetsPlaced} bets placed\n{wins}W - {losses}L ({winRate}%)\nP&L: {+/-$netPnl}\n\nTop model: {topCompetitor.name} ({+/-$pnl})\n{upcomingFixtures} fixtures ahead"` |
| `bets_failed` | Skip |
| `iteration_complete` | Skip |

Templates use string interpolation with the notification payload fields. For batch events (multiple bets placed/settled at once), one tweet per bet to keep each tweet focused and readable. If credentials are empty, the adapter no-ops with a debug log.

OAuth 1.0a signing: use the `oauth-1.0a` npm package (lightweight, no heavy dependencies) + Node's built-in `crypto` for HMAC-SHA1.

### `src/apis/notifications/adapter-registry.ts`

Register the Twitter adapter factory.

```typescript
import { createTwitterAdapter } from "./adapters/twitter.ts";

export const defaultAdapterFactories: Map<string, AdapterFactory> = new Map([
  ["discord", createDiscordAdapter],
  ["twitter", createTwitterAdapter],
]);
```

### `src/database/schema.ts`

Expand the `type` enum on `notificationChannels` to include `"twitter"`.

```typescript
type: text("type", { enum: ["discord", "twitter"] }).notNull(),
```

Add an optional `eventFilter` column so channels can opt into specific event types:

```typescript
eventFilter: text("event_filter", { mode: "json" }).$type<string[]>(),
// e.g., ["bets_settled", "weekly_summary"] — null means all events
```

### `drizzle/` — new migration

Migration to add `event_filter` column to `notification_channels` and update type enum. SQLite doesn't enforce enum constraints in `text` columns, so no data migration needed for the type change.

```sql
ALTER TABLE notification_channels ADD COLUMN event_filter TEXT;
```

### `src/database/repositories/notification-channels.ts`

No structural changes needed — the existing `findEnabled()` already returns all columns. The `eventFilter` field will be available on returned rows automatically via Drizzle inference.

### `src/domain/services/notification.ts`

Add event filtering logic — check `channel.eventFilter` before dispatching.

```typescript
async notify(event: NotificationEvent): Promise<void> {
  const channels = await channelsRepo.findEnabled();
  await Promise.allSettled(
    channels
      .filter((ch) => {
        const filter = ch.eventFilter as string[] | null;
        return !filter || filter.includes(event.type);
      })
      .map(async (channel) => {
        // ... existing adapter dispatch logic
      }),
  );
},
```

### `src/apis/notifications/adapters/discord.ts`

Add formatting for the `weekly_summary` event type.

```typescript
function formatWeeklySummary(summary: WeeklySummaryNotification): DiscordPayload {
  const pnlSign = summary.netPnl >= 0 ? "+" : "";
  return {
    username: BOT_NAME,
    embeds: [{
      title: "Weekly Summary",
      color: summary.netPnl >= 0 ? COLOR_GREEN : COLOR_RED,
      fields: [
        { name: "Period", value: `${summary.periodStart} — ${summary.periodEnd}`, inline: false },
        { name: "Bets Placed", value: `${summary.totalBetsPlaced}`, inline: true },
        { name: "Settled", value: `${summary.wins}W - ${summary.losses}L`, inline: true },
        { name: "Win Rate", value: `${(summary.winRate * 100).toFixed(1)}%`, inline: true },
        { name: "Total Staked", value: `$${summary.totalStaked.toFixed(2)}`, inline: true },
        { name: "Net P&L", value: `${pnlSign}$${summary.netPnl.toFixed(2)}`, inline: true },
        ...(summary.topCompetitor ? [{
          name: "Top Competitor",
          value: `${summary.topCompetitor.name}: ${summary.topCompetitor.pnl >= 0 ? "+" : ""}$${summary.topCompetitor.pnl.toFixed(2)}`,
          inline: true,
        }] : []),
        { name: "Upcoming Fixtures", value: `${summary.upcomingFixtures}`, inline: true },
      ],
      footer: { text: "LLM Betting Competition — Weekly Report" },
      timestamp: new Date().toISOString(),
    }],
  };
}
```

### `src/orchestrator/summary-pipeline.ts` (new file)

Pipeline that aggregates data and dispatches `weekly_summary` notification.

```typescript
export type SummaryPipelineDeps = {
  betsRepo: BetsRepo;
  fixturesRepo: FixturesRepo;
  competitorsRepo: CompetitorsRepo;
  notificationService: NotificationService;
};

export function createSummaryPipeline(deps: SummaryPipelineDeps) {
  return {
    async run(): Promise<void> {
      const periodEnd = new Date();
      const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

      // 1. Query bets placed in period
      // 2. Query settled bets in period
      // 3. Aggregate stats (wins, losses, P&L per competitor)
      // 4. Find top competitor by P&L
      // 5. Count upcoming fixtures
      // 6. Build WeeklySummaryNotification
      // 7. Dispatch via notificationService.notify()
    },
  };
}

export type SummaryPipeline = ReturnType<typeof createSummaryPipeline>;
```

### `src/database/repositories/bets.ts`

Add batch query methods for summary aggregation. These should use date range filters to avoid loading all bets.

```typescript
async findPlacedInRange(start: Date, end: Date) {
  return db.select().from(bets)
    .where(and(
      gte(bets.placedAt, start),
      lte(bets.placedAt, end),
    ))
    .all();
},

async findSettledInRange(start: Date, end: Date) {
  return db.select().from(bets)
    .where(and(
      isNotNull(bets.settledAt),
      gte(bets.settledAt, start),
      lte(bets.settledAt, end),
    ))
    .all();
},
```

### `src/orchestrator/config.ts`

Add summary interval config.

```typescript
summaryIntervalMs: number; // default: 7 * 24 * 60 * 60 * 1000 (weekly)
summaryDelayMs?: number;
```

### `src/orchestrator/scheduler.ts`

Add summary pipeline to scheduler deps and run loop.

```typescript
// In SchedulerDeps:
summaryPipeline?: SummaryPipeline;

// In start():
if (summaryPipeline) {
  summaryTimer = setInterval(runSummary, config.summaryIntervalMs);
}
```

### `src/index.ts`

Wire up the summary pipeline and pass to scheduler.

### `src/shared/env.ts`

Add Twitter API credentials as env vars, consistent with how other API keys are managed in the project.

```typescript
// Add to envSchema:
TWITTER_CONSUMER_KEY: z.string().default(""),
TWITTER_CONSUMER_SECRET: z.string().default(""),
TWITTER_ACCESS_TOKEN: z.string().default(""),
TWITTER_ACCESS_TOKEN_SECRET: z.string().default(""),
```

All default to empty string — Twitter adapter is a no-op if credentials are missing (logs a warning, skips sending). Same pattern as `OPENROUTER_API_KEY`.

### `package.json`

Add `oauth-1.0a` dependency for Twitter API signing.

```bash
bun add oauth-1.0a
```

---

## Data & Migration

One migration: add `event_filter` column to `notification_channels`.

```sql
ALTER TABLE notification_channels ADD COLUMN event_filter TEXT;
```

Existing channels get `NULL` event_filter, meaning they receive all events (backward compatible). The `type` enum expansion from `["discord"]` to `["discord", "twitter"]` requires no migration — SQLite stores it as plain text.

---

## Test Plan

### `tests/unit/apis/notifications/adapters/twitter.test.ts` (new)

- **Formats `bets_placed` correctly** — verifies tweet text includes fixture, side, price, stake, competitor
- **Formats `bets_settled` (won) correctly** — verifies tweet includes won indicator, profit
- **Formats `bets_settled` (lost) correctly** — verifies tweet includes lost indicator, amount
- **Formats `weekly_summary` correctly** — verifies tweet text includes win rate, P&L, top competitor
- **Skips `bets_failed`** — returns null, no tweet sent
- **Skips `iteration_complete`** — returns null, no tweet sent
- **Sends one tweet per bet** — batch of 3 placed bets produces 3 API calls
- **No-ops when credentials are empty** — logs debug message, does not call Twitter API
- **Respects 280 char limit** — tweet text is truncated if needed
- **OAuth signing produces valid Authorization header** — mock fetch, verify header format

### `tests/unit/apis/notifications/adapters/discord.test.ts` (extend)

- **Formats `weekly_summary` embed** — verifies embed fields, colors, footer

### `tests/unit/domain/services/notification.test.ts` (extend)

- **Event filtering** — channel with `eventFilter: ["weekly_summary"]` only receives summary events
- **Null filter receives all** — channel with `eventFilter: null` receives everything
- **Multiple channels with different filters** — each channel only gets its filtered events

### `tests/unit/orchestrator/summary-pipeline.test.ts` (new)

- **Builds correct summary from bet data** — mock repos return known bets, verify aggregation
- **Handles empty period** — no bets in range produces zeroed summary
- **Top competitor calculation** — correctly identifies highest P&L competitor
- **Dispatches via notification service** — verify `notify()` called with `weekly_summary` event

### `tests/unit/database/repositories/bets.test.ts` (extend)

- **`findPlacedInRange`** — returns only bets within date range
- **`findSettledInRange`** — returns only settled bets within date range

---

## Task Breakdown

- [x] Add `WeeklySummaryNotification` type and `weekly_summary` variant to `NotificationEvent` union in `src/domain/types/notification.ts`
- [x] Add `NotificationEventType` type alias to `src/domain/types/notification.ts`
- [x] Update `notificationChannels` schema: expand type enum to `["discord", "twitter"]` and add `event_filter` column in `src/database/schema.ts`
- [x] Generate and apply Drizzle migration for `event_filter` column
- [x] Add `findPlacedInRange` and `findSettledInRange` methods to `src/database/repositories/bets.ts`
- [x] Write tests for new bets repo range methods in `tests/unit/database/repositories/bets.test.ts`
- [x] Add event filtering logic to `src/domain/services/notification.ts` — filter channels by `eventFilter` before dispatch
- [x] Write tests for event filtering in `tests/unit/domain/services/notification.test.ts`
- [x] Add `TWITTER_CONSUMER_KEY`, `TWITTER_CONSUMER_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET` to `src/shared/env.ts`
- [x] Install `oauth-1.0a` package (removed — implemented OAuth 1.0a signing with built-in crypto instead)
- [x] Create `src/apis/notifications/adapters/twitter.ts` — implement `createTwitterAdapter` with OAuth 1.0a signing, tweet templates for `bets_placed`, `bets_settled`, `weekly_summary`; skip `bets_failed` and `iteration_complete`; one tweet per bet for batch events; no-op when credentials are empty
- [x] Register Twitter adapter in `src/apis/notifications/adapter-registry.ts`
- [x] Write tests for Twitter adapter in `tests/unit/apis/notifications/adapters/twitter.test.ts`
- [x] Add `weekly_summary` formatting to Discord adapter in `src/apis/notifications/adapters/discord.ts`
- [x] Write tests for Discord weekly summary formatting in `tests/unit/apis/notifications/adapters/discord.test.ts`
- [x] Create `src/orchestrator/summary-pipeline.ts` — query bets/fixtures repos, aggregate stats, dispatch `weekly_summary` event
- [x] Add `summaryIntervalMs` and `summaryDelayMs` to `PipelineConfig` in `src/orchestrator/config.ts`
- [x] Integrate summary pipeline into scheduler in `src/orchestrator/scheduler.ts`
- [x] Wire summary pipeline in `src/index.ts`
- [x] Write tests for summary pipeline in `tests/unit/orchestrator/summary-pipeline.test.ts`
- [x] Run `bun run typecheck`, `bun run lint`, `bun run test` — all must pass
