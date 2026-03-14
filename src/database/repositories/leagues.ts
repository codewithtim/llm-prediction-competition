import { and, eq, sql } from "drizzle-orm";
import type { LeagueConfig } from "../../orchestrator/config.ts";
import type { Database } from "../client";
import { leagues } from "../schema";

export type LeagueRow = typeof leagues.$inferSelect;

export function toLeagueConfig(row: LeagueRow): LeagueConfig {
  return {
    id: row.id,
    sport: row.sport,
    name: row.name,
    country: row.country,
    type: row.type,
    polymarketSeriesSlug: row.polymarketSeriesSlug,
    domesticLeagueIds: row.domesticLeagueIds ?? undefined,
    tier: row.tier,
  };
}

export function leaguesRepo(db: Database) {
  return {
    async findEnabled() {
      return db.select().from(leagues).where(eq(leagues.enabled, true)).all();
    },

    async findEnabledBySport(sport: string) {
      return db
        .select()
        .from(leagues)
        .where(and(eq(leagues.enabled, true), eq(leagues.sport, sport)))
        .all();
    },

    async findAll() {
      return db.select().from(leagues).all();
    },

    async findById(id: number) {
      return db.select().from(leagues).where(eq(leagues.id, id)).get();
    },

    async setEnabled(id: number, enabled: boolean) {
      await db
        .update(leagues)
        .set({ enabled, updatedAt: new Date() })
        .where(eq(leagues.id, id))
        .run();
    },

    async upsert(league: typeof leagues.$inferInsert) {
      return db
        .insert(leagues)
        .values(league)
        .onConflictDoUpdate({
          target: leagues.id,
          set: {
            sport: sql.raw("excluded.sport"),
            name: sql.raw("excluded.name"),
            country: sql.raw("excluded.country"),
            type: sql.raw("excluded.type"),
            polymarketSeriesSlug: sql.raw("excluded.polymarket_series_slug"),
            domesticLeagueIds: sql.raw("excluded.domestic_league_ids"),
            tier: sql.raw("excluded.tier"),
            enabled: sql.raw("excluded.enabled"),
            updatedAt: new Date(),
          },
        })
        .run();
    },
  };
}
