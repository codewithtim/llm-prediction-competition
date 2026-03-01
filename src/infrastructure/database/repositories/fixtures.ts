import { eq } from "drizzle-orm";
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
