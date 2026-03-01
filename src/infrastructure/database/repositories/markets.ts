import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Database } from "../client";
import { markets } from "../schema";

export function marketsRepo(db: Database) {
  return {
    async upsert(market: typeof markets.$inferInsert) {
      return db
        .insert(markets)
        .values(market)
        .onConflictDoUpdate({
          target: markets.id,
          set: {
            outcomePrices: market.outcomePrices,
            active: market.active,
            closed: market.closed,
            acceptingOrders: market.acceptingOrders,
            liquidity: market.liquidity,
            volume: market.volume,
            fixtureId: market.fixtureId,
            updatedAt: new Date(),
          },
        })
        .run();
    },

    async bulkUpsert(rows: (typeof markets.$inferInsert)[]) {
      if (rows.length === 0) return;
      return db
        .insert(markets)
        .values(rows)
        .onConflictDoUpdate({
          target: markets.id,
          set: {
            outcomePrices: sql.raw("excluded.outcome_prices"),
            active: sql.raw("excluded.active"),
            closed: sql.raw("excluded.closed"),
            acceptingOrders: sql.raw("excluded.accepting_orders"),
            liquidity: sql.raw("excluded.liquidity"),
            volume: sql.raw("excluded.volume"),
            fixtureId: sql.raw("excluded.fixture_id"),
            updatedAt: new Date(),
          },
        })
        .run();
    },

    async findById(id: string) {
      return db.select().from(markets).where(eq(markets.id, id)).get();
    },

    async findActive() {
      return db.select().from(markets).where(eq(markets.active, true)).all();
    },

    async findByGameId(gameId: string) {
      return db.select().from(markets).where(eq(markets.gameId, gameId)).all();
    },

    async findByFixtureId(fixtureId: number) {
      return db.select().from(markets).where(eq(markets.fixtureId, fixtureId)).all();
    },

    async findActiveWithFixture() {
      return db
        .select()
        .from(markets)
        .where(and(eq(markets.active, true), isNotNull(markets.fixtureId)))
        .all();
    },
  };
}
