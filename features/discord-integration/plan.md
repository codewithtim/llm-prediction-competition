# Plan: Generic Notification System with Discord Adapter

**Date:** 2026-03-04
**Status:** Draft

---

## Overview

Add a generic notification layer for three key events — bets placed, bets settled, and model iterations. The system uses a database-managed channel registry, a common adapter interface, and platform-specific adapters. The domain layer never knows about Discord (or any other platform) — it just dispatches typed events through the `NotificationService`, which loads enabled channels from the DB, resolves the correct adapter, and sends. Discord is the first adapter implementation.

---

## Architecture

```
src/domain/types/notification.ts                  # Event types + adapter interface
src/domain/services/notification.ts               # NotificationService — loads channels, dispatches
src/apis/notifications/adapters/discord.ts        # Discord webhook adapter (format + send)
src/database/
  schema.ts                                       # Add notification_channels table
  repositories/notification-channels.ts           # CRUD repo
src/scripts/add-notification-channel.ts           # CLI seed script
```

**Three layers:**

1. **Domain types** — `NotificationEvent` discriminated union and `NotificationAdapter` interface live in `src/domain/types/notification.ts`. Platform-agnostic.
2. **Notification service** — `createNotificationService` in `src/domain/services/notification.ts`. Loads enabled channels from the DB, resolves the correct adapter factory for each channel type, dispatches events. Fire-and-forget — errors logged, never thrown.
3. **Adapters** — each platform gets an adapter in `src/apis/notifications/adapters/`. An adapter is a factory function `(config) => NotificationAdapter`. It owns both message formatting (templates) and HTTP transport. Discord is the first.

**Channel registry in DB** — a `notification_channels` table stores channel type, name, JSON config (webhook URL, API keys, etc.), and an enabled flag. Adding a new Discord channel or Twitter account is a DB insert — no code changes needed.

---

## Changes Required

### `src/database/schema.ts` — add `notificationChannels` table

```ts
export const notificationChannels = sqliteTable("notification_channels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),                                    // "Main Discord", "Alerts Twitter"
  type: text("type", { enum: ["discord"] }).notNull(),             // extensible — add "twitter", "slack" later
  config: text("config", { mode: "json" }).$type<Record<string, string>>().notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
```

Config shape per type:
- **Discord:** `{ webhookUrl: "https://discord.com/api/webhooks/..." }`
- **Twitter (future):** `{ apiKey: "...", apiSecret: "...", accessToken: "...", accessSecret: "..." }`

### `src/database/repositories/notification-channels.ts` — new repo

```ts
export function notificationChannelsRepo(db: Database) {
  return {
    async findEnabled() { /* WHERE enabled = true */ },
    async findAll() { ... },
    async findById(id: number) { ... },
    async create(channel: typeof notificationChannels.$inferInsert) { ... },
    async update(id: number, data: Partial<Pick<..., "name" | "config" | "enabled">>) { ... },
  };
}
```

### `src/domain/types/notification.ts` — new file, event types + adapter interface

```ts
export type PlacedBetNotification = {
  competitorId: string;
  marketQuestion: string;
  fixtureLabel: string;
  side: "YES" | "NO";
  amount: number;
  price: number;
};

export type SettledBetNotification = {
  betId: string;
  competitorId: string;
  marketQuestion: string;
  side: "YES" | "NO";
  outcome: "won" | "lost";
  profit: number;
};

export type IterationNotification = {
  competitorId: string;
  competitorName: string;
  version: number;
  model: string;
};

export type IterationFailureNotification = {
  competitorId: string;
  competitorName: string;
  error: string;
};

export type NotificationEvent =
  | { type: "bets_placed"; bets: PlacedBetNotification[] }
  | { type: "bets_settled"; bets: SettledBetNotification[] }
  | { type: "iteration_complete"; successes: IterationNotification[]; failures: IterationFailureNotification[] };

export type NotificationAdapter = {
  send(event: NotificationEvent): Promise<void>;
};

export type AdapterFactory = (config: Record<string, string>) => NotificationAdapter;
```

### `src/domain/services/notification.ts` — new file, notification service

```ts
export function createNotificationService(deps: {
  channelsRepo: ReturnType<typeof notificationChannelsRepo>;
  adapterFactories: Map<string, AdapterFactory>;
}) {
  return {
    async notify(event: NotificationEvent): Promise<void> {
      const channels = await deps.channelsRepo.findEnabled();
      for (const channel of channels) {
        const factory = deps.adapterFactories.get(channel.type);
        if (!factory) {
          logger.warn("No adapter for notification channel type", { type: channel.type });
          continue;
        }
        const adapter = factory(channel.config);
        try {
          await adapter.send(event);
        } catch (err) {
          logger.error("Notification send failed", { channel: channel.name, type: channel.type, error: ... });
        }
      }
    },
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
```

Key: errors are caught per-channel — one failing channel doesn't block others.

### `src/apis/notifications/adapters/discord.ts` — new file

Factory function that returns a `NotificationAdapter`. Contains all Discord-specific formatting (embeds, colors, field layouts) and HTTP transport (webhook POST).

```ts
export function createDiscordAdapter(config: Record<string, string>): NotificationAdapter {
  const webhookUrl = config.webhookUrl;
  if (!webhookUrl) throw new Error("Discord adapter requires webhookUrl in config");

  return {
    async send(event: NotificationEvent): Promise<void> {
      const payload = formatEvent(event);
      if (!payload) return;
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    },
  };
}

function formatEvent(event: NotificationEvent): DiscordPayload | null {
  switch (event.type) {
    case "bets_placed": return formatBetsPlaced(event.bets);
    case "bets_settled": return formatBetsSettled(event.bets);
    case "iteration_complete": return formatIteration(event.successes, event.failures);
  }
}
```

Embed designs:
- **Bets Placed** — Green (`0x00C853`). Title: "Bets Placed". Field per bet: market question, side, stake, price, competitor.
- **Bets Settled** — Color based on net P&L (green if positive, red if negative). Title: "Bets Settled". Field per bet with outcome and profit. Footer: net P&L.
- **Iteration Complete** — Purple (`0x9C27B0`). Title: "Model Iteration". Field per competitor with version and model. Failures in red if any.

### `src/orchestrator/prediction-pipeline.ts` — enrich result with bet details

Add `PlacedBetDetail` type and `placedBetDetails` array to `PredictionPipelineResult`:

```ts
export type PlacedBetDetail = {
  competitorId: string;
  marketId: string;
  fixtureId: number;
  side: "YES" | "NO";
  amount: number;
  price: number;
  marketQuestion: string;
  fixtureLabel: string;
};

// Add to PredictionPipelineResult:
placedBetDetails: PlacedBetDetail[];
```

Populate in `processFixture` when `betResult.status === "placed"`.

### `src/domain/services/settlement.ts` — add `marketQuestion` to `SettledBet`

The settlement service already fetches market data. Extend `resolvedMarkets` to carry `question`:

```ts
const resolvedMarkets = new Map<string, { outcomePrices: [string, string]; question: string }>();
```

Add `marketQuestion` to the `SettledBet` type and populate from the map.

### `src/orchestrator/scheduler.ts` — add `notificationService?` to deps

```ts
// In SchedulerDeps:
notificationService?: NotificationService;

// In runPredictions(), after pipeline completes:
if (notificationService && result.placedBetDetails.length > 0) {
  notificationService.notify({
    type: "bets_placed",
    bets: result.placedBetDetails.map(b => ({
      competitorId: b.competitorId,
      marketQuestion: b.marketQuestion,
      fixtureLabel: b.fixtureLabel,
      side: b.side,
      amount: b.amount,
      price: b.price,
    })),
  }).catch(() => {}); // fire-and-forget
}

// In runSettlement(), after settlement completes:
if (notificationService && result.settled.length > 0) {
  notificationService.notify({
    type: "bets_settled",
    bets: result.settled.map(s => ({
      betId: s.betId,
      competitorId: s.competitorId,
      marketQuestion: s.marketQuestion,
      side: s.side,
      outcome: s.outcome,
      profit: s.profit,
    })),
  }).catch(() => {});
}
```

### `src/index.ts` — wire up notification service

```ts
import { notificationChannelsRepo } from "./database/repositories/notification-channels.ts";
import { createNotificationService } from "./domain/services/notification.ts";
import { createDiscordAdapter } from "./apis/notifications/adapters/discord.ts";

const notifChannels = notificationChannelsRepo(db);
const adapterFactories = new Map<string, AdapterFactory>([
  ["discord", createDiscordAdapter],
]);
const notificationService = createNotificationService({
  channelsRepo: notifChannels,
  adapterFactories,
});

const scheduler = createScheduler({
  // ...existing deps...
  notificationService,
});
```

### `src/scripts/iterate.ts` — add notification after iteration

Create notification service inline (same pattern as index.ts), call `notificationService.notify({ type: "iteration_complete", ... })` after results are computed.

### `src/scripts/add-notification-channel.ts` — new seed script

```ts
// Usage:
//   bun run src/scripts/add-notification-channel.ts --type discord --name "Main Discord" --config '{"webhookUrl":"https://..."}'
//   bun run src/scripts/add-notification-channel.ts --list
//   bun run src/scripts/add-notification-channel.ts --disable <id>
//   bun run src/scripts/add-notification-channel.ts --enable <id>
```

Follows existing script patterns: exported pure arg parser, exported business logic function, guarded `main()`.

### `.env.example` — no changes needed

Channel config lives in the DB, not env vars. No `DISCORD_WEBHOOK_URL` needed.

### Migration

Generate via `bunx drizzle-kit generate` after adding the table to schema.ts. Applied with standard migration flow.

---

## Trade-offs

- **DB-managed channels vs env vars:** More setup (migration, seed script), but supports multiple channels of the same type, enable/disable without redeploy, and future API/UI management.
- **Adapter-per-channel-type vs shared template engine:** Each adapter owns its formatting. Simpler, type-safe, but adding a new platform means writing a new adapter. Given code-defined templates, this is the right granularity.
- **Service creates adapters per-notify call:** The service calls `adapterFactory(config)` on each `notify()`. These are cheap (no persistent connections), and it means config changes in the DB take effect immediately without restart. If this becomes a perf concern, we could cache adapters keyed by channel ID + config hash.
- **No retry on notification failure:** Notifications are informational. Failed sends are logged and skipped. A dead-letter or retry queue would add significant complexity for minimal value.

---

## Test Plan

### `tests/unit/apis/notifications/adapters/discord.test.ts`
- Formats `bets_placed` event into correct Discord embed (green, fields per bet)
- Formats `bets_settled` event with correct color based on net P&L
- Formats `iteration_complete` event with successes and failures
- Sends correct HTTP payload to webhook URL
- Handles HTTP errors gracefully (no throw)
- Handles network errors gracefully (no throw)
- Throws on missing `webhookUrl` in config

### `tests/unit/domain/services/notification.test.ts`
- Dispatches event to all enabled channels
- Skips disabled channels (not returned by `findEnabled`)
- Skips channels with unknown adapter type (logs warning)
- One failing channel doesn't prevent others from receiving
- Works when no channels are configured (no-op)

### `tests/unit/database/repositories/notification-channels.test.ts`
- Creates a channel and retrieves it
- `findEnabled` only returns enabled channels
- Update toggles enabled flag

### Extend existing tests
- `prediction-pipeline.test.ts` — verify `placedBetDetails` populated on successful bet
- `settlement.test.ts` — verify `marketQuestion` included in settled result

---

## Task Breakdown

- [x] Add `notificationChannels` table to `src/database/schema.ts`
- [x] Generate migration with `bunx drizzle-kit generate`
- [x] Create `src/database/repositories/notification-channels.ts` — findEnabled, findAll, findById, create, update
- [x] Create `tests/unit/database/repositories/notification-channels.test.ts`
- [x] Create `src/domain/types/notification.ts` — event types, adapter interface, adapter factory type
- [x] Create `src/apis/notifications/adapters/discord.ts` — Discord adapter with embed formatting
- [x] Create `tests/unit/apis/notifications/adapters/discord.test.ts`
- [x] Create `src/domain/services/notification.ts` — createNotificationService
- [x] Create `tests/unit/domain/services/notification.test.ts`
- [x] Add `PlacedBetDetail` type and `placedBetDetails` array to `PredictionPipelineResult` in `src/orchestrator/prediction-pipeline.ts`
- [x] Populate `placedBetDetails` in `processFixture` when bet is placed; initialise `placedBetDetails: []` in `run()`
- [x] Add `marketQuestion` to `SettledBet` type in `src/domain/services/settlement.ts`
- [x] Change `resolvedMarkets` Map to carry `question` alongside `outcomePrices`; populate `marketQuestion` in settled results
- [x] Add `notificationService?: NotificationService` to `SchedulerDeps` in `src/orchestrator/scheduler.ts`
- [x] Call `notificationService.notify()` after prediction run (when `placedBetDetails.length > 0`) and after settlement (when `settled.length > 0`)
- [x] Wire notification service in `src/index.ts` — create repo, adapter factories map, notification service, pass to scheduler
- [x] Create `src/scripts/add-notification-channel.ts` — CLI for adding/listing/toggling channels
- [x] Add notification dispatch to `src/scripts/iterate.ts` after iteration completes
- [x] Extend existing prediction pipeline tests for `placedBetDetails`
- [x] Extend existing settlement tests for `marketQuestion`
- [ ] Run `bun test` — all tests pass
- [ ] Run `bunx biome check --write` — clean formatting
