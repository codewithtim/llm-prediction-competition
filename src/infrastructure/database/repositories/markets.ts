import { and, eq, isNotNull } from "drizzle-orm";
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
