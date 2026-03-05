import { eq } from "drizzle-orm";
import { logger } from "../../shared/logger";
import type { Database } from "../client";
import { bettingEvents } from "../schema";

export function bettingEventsRepo(db: Database) {
  return {
    async record(entry: typeof bettingEvents.$inferInsert) {
      return db.insert(bettingEvents).values(entry).run();
    },

    async safeRecord(entry: typeof bettingEvents.$inferInsert) {
      try {
        await db.insert(bettingEvents).values(entry).run();
      } catch (e) {
        logger.warn("Betting event write failed", {
          competitorId: entry.competitorId,
          event: entry.event,
          error: e,
        });
      }
    },

    async findByCompetitor(competitorId: string) {
      return db
        .select()
        .from(bettingEvents)
        .where(eq(bettingEvents.competitorId, competitorId))
        .orderBy(bettingEvents.timestamp)
        .all();
    },
  };
}

export type BettingEventsRepo = ReturnType<typeof bettingEventsRepo>;
