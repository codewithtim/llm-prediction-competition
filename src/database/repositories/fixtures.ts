import { and, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import type { Database } from "../client";
import { fixtures } from "../schema";

function toISONoMs(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

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

    async findReadyForPrediction(leadTimeMs: number, leagueIds?: number[]) {
      const now = toISONoMs(new Date());
      const cutoff = toISONoMs(new Date(Date.now() + leadTimeMs));
      const conditions = [
        eq(fixtures.status, "scheduled"),
        lte(fixtures.date, cutoff),
        gt(fixtures.date, now),
      ];
      if (leagueIds && leagueIds.length > 0) {
        conditions.push(inArray(fixtures.leagueId, leagueIds));
      }
      return db
        .select()
        .from(fixtures)
        .where(and(...conditions))
        .all();
    },

    async findNeedingStatusUpdate() {
      const now = toISONoMs(new Date());
      return db
        .select()
        .from(fixtures)
        .where(
          or(
            and(eq(fixtures.status, "scheduled"), lte(fixtures.date, now)),
            eq(fixtures.status, "in_progress"),
          ),
        )
        .all();
    },

    async updateStatus(
      id: number,
      status: "scheduled" | "in_progress" | "finished" | "postponed" | "cancelled",
    ) {
      return db
        .update(fixtures)
        .set({ status, updatedAt: new Date() })
        .where(eq(fixtures.id, id))
        .run();
    },
  };
}
