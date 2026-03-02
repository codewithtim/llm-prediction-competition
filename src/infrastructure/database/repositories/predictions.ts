import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { predictions } from "../schema";

export function predictionsRepo(db: Database) {
  return {
    async create(prediction: typeof predictions.$inferInsert) {
      return db.insert(predictions).values(prediction).run();
    },

    async findAll() {
      return db.select().from(predictions).all();
    },

    async findRecent(limit: number) {
      return db.select().from(predictions).orderBy(desc(predictions.createdAt)).limit(limit).all();
    },

    async findByCompetitor(competitorId: string) {
      return db.select().from(predictions).where(eq(predictions.competitorId, competitorId)).all();
    },

    async findByMarket(marketId: string) {
      return db.select().from(predictions).where(eq(predictions.marketId, marketId)).all();
    },

    async findByFixtureAndCompetitor(fixtureId: number, competitorId: string) {
      return db
        .select()
        .from(predictions)
        .where(
          and(eq(predictions.fixtureId, fixtureId), eq(predictions.competitorId, competitorId)),
        )
        .all();
    },
  };
}
