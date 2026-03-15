/**
 * Test Discord notification — checks DB for configured channels and sends a test message.
 *
 * Usage:
 *   bun run src/scripts/test-discord.ts              Check channels and send test notification
 *   bun run src/scripts/test-discord.ts --check-only Just check what channels are configured
 */

import { defaultAdapterFactories } from "../apis/notifications/adapter-registry";
import { createDb } from "../database/client";
import { notificationChannelsRepo } from "../database/repositories/notification-channels";
import { createNotificationService } from "../domain/services/notification";
import type { NotificationEvent } from "../domain/types/notification";
import { env } from "../shared/env";

const checkOnly = process.argv.includes("--check-only");

const db = createDb(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
const channelsRepo = notificationChannelsRepo(db);

const allChannels = await channelsRepo.findAll();
const enabledChannels = await channelsRepo.findEnabled();

console.log(`\nAll channels (${allChannels.length}):`);
for (const ch of allChannels) {
  const status = ch.enabled ? "ENABLED" : "DISABLED";
  const filter = ch.eventFilter ? JSON.stringify(ch.eventFilter) : "all events";
  console.log(`  [${ch.id}] ${ch.name} (${ch.type}) — ${status} — filter: ${filter}`);
  console.log(`         config: ${JSON.stringify(ch.config)}`);
}

console.log(`\nEnabled channels: ${enabledChannels.length}`);

if (enabledChannels.length === 0) {
  console.log("\n⚠️  No enabled notification channels found!");
  console.log("This is likely why Discord notifications are not working.");
  console.log("\nTo add a Discord channel, run:");
  console.log(
    '  bun run src/scripts/add-notification-channel.ts --type discord --name "Discord" --config \'{"webhookUrl":"https://discord.com/api/webhooks/..."}\'',
  );
  process.exit(1);
}

if (checkOnly) {
  console.log("\n--check-only mode, skipping test send.");
  process.exit(0);
}

const notificationService = createNotificationService({
  channelsRepo,
  adapterFactories: defaultAdapterFactories,
});

const testEvent: NotificationEvent = {
  type: "bets_placed",
  bets: [
    {
      competitorId: "test",
      marketQuestion: "Test Notification — please ignore",
      fixtureLabel: "Test Fixture v Test Fixture",
      side: "YES",
      amount: 0,
      price: 0.5,
    },
  ],
};

console.log("\nSending test notification...");
try {
  await notificationService.notify(testEvent);
  console.log("✅ Test notification sent. Check your Discord channel.");
} catch (err) {
  console.error("❌ Test notification failed:", err);
  process.exit(1);
}
