import { eq } from "drizzle-orm";
import type { Database } from "../client";
import { notificationChannels } from "../schema";

export function notificationChannelsRepo(db: Database) {
  return {
    async findEnabled() {
      return db
        .select()
        .from(notificationChannels)
        .where(eq(notificationChannels.enabled, true))
        .all();
    },

    async findAll() {
      return db.select().from(notificationChannels).all();
    },

    async findById(id: number) {
      return db.select().from(notificationChannels).where(eq(notificationChannels.id, id)).get();
    },

    async create(channel: typeof notificationChannels.$inferInsert) {
      return db.insert(notificationChannels).values(channel).run();
    },

    async update(
      id: number,
      data: Partial<Pick<typeof notificationChannels.$inferSelect, "name" | "config" | "enabled">>,
    ) {
      return db
        .update(notificationChannels)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(notificationChannels.id, id))
        .run();
    },
  };
}

export type NotificationChannelsRepo = ReturnType<typeof notificationChannelsRepo>;
