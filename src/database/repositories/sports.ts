import { eq, sql } from "drizzle-orm";
import type { Database } from "../client";
import { sports } from "../schema";

export function sportsRepo(db: Database) {
  return {
    async findEnabled() {
      return db.select().from(sports).where(eq(sports.enabled, true)).all();
    },

    async findAll() {
      return db.select().from(sports).all();
    },

    async findBySlug(slug: string) {
      return db.select().from(sports).where(eq(sports.slug, slug)).get();
    },

    async upsert(sport: typeof sports.$inferInsert) {
      return db
        .insert(sports)
        .values(sport)
        .onConflictDoUpdate({
          target: sports.slug,
          set: {
            name: sql.raw("excluded.name"),
            polymarketTagId: sql.raw("excluded.polymarket_tag_id"),
            enabled: sql.raw("excluded.enabled"),
            updatedAt: new Date(),
          },
        })
        .run();
    },
  };
}
