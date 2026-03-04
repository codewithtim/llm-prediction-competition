import { eq } from "drizzle-orm";
import { logger } from "../../shared/logger";
import type { Database } from "../client";
import { betAuditLog } from "../schema";

export function auditLogRepo(db: Database) {
  return {
    async record(entry: typeof betAuditLog.$inferInsert) {
      return db.insert(betAuditLog).values(entry).run();
    },

    async safeRecord(entry: typeof betAuditLog.$inferInsert) {
      try {
        await db.insert(betAuditLog).values(entry).run();
      } catch (e) {
        logger.warn("Audit log write failed", { betId: entry.betId, event: entry.event, error: e });
      }
    },

    async findByBetId(betId: string) {
      return db
        .select()
        .from(betAuditLog)
        .where(eq(betAuditLog.betId, betId))
        .orderBy(betAuditLog.timestamp)
        .all();
    },
  };
}

export type AuditLogRepo = ReturnType<typeof auditLogRepo>;
