import type { NotificationChannelsRepo } from "../../database/repositories/notification-channels.ts";
import { logger } from "../../shared/logger.ts";
import type { AdapterFactory, NotificationEvent } from "../types/notification.ts";

export function createNotificationService(deps: {
  channelsRepo: NotificationChannelsRepo;
  adapterFactories: Map<string, AdapterFactory>;
}) {
  const { channelsRepo, adapterFactories } = deps;

  return {
    async notify(event: NotificationEvent): Promise<void> {
      const channels = await channelsRepo.findEnabled();
      await Promise.allSettled(
        channels.map(async (channel) => {
          const factory = adapterFactories.get(channel.type);
          if (!factory) {
            logger.warn("No adapter for notification channel type", { type: channel.type });
            return;
          }
          const adapter = factory(channel.config as Record<string, string>);
          try {
            await adapter.send(event);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error("Notification send failed", {
              channel: channel.name,
              type: channel.type,
              error: msg,
            });
          }
        }),
      );
    },
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
