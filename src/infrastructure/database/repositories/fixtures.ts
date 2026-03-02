import { eq, sql } from "drizzle-orm";
import type { Database } from "../client";
import { fixtures } from "../schema";

export function fixturesRepo(db: Database) {
  return {
    async upsert(fixture: typeof fixtures.$inferInsert) {
      return db
        .insert(fixtures)
        .values(fixture)
        .onConflictDoUpdate({
          target: fixtures.id,
          set: {
            status: fixture.status,
            venue: fixture.venue,
            updatedAt: new Date(),
          },
        })
        .run();
    },

    async bulkUpsert(rows: (typeof fixtures.$inferInsert)[]) {
      if (rows.length === 0) return;
      return db
        .insert(fixtures)
        .values(rows)
        .onConflictDoUpdate({
          target: fixtures.id,
          set: {
            status: sql.raw("excluded.status"),
            venue: sql.raw("excluded.venue"),
            updatedAt: new Date(),
          },
        })
        .run();
    },

    async findAll() {
      return db.select().from(fixtures).all();
    },

    async findById(id: number) {
      return db.select().from(fixtures).where(eq(fixtures.id, id)).get();
    },

    async findByStatus(
      status: "scheduled" | "in_progress" | "finished" | "postponed" | "cancelled",
    ) {
      return db.select().from(fixtures).where(eq(fixtures.status, status)).all();
    },

    async findScheduledUpcoming() {
      return db.select().from(fixtures).where(eq(fixtures.status, "scheduled")).all();
    },
  };
}
