import { eq } from "drizzle-orm";
import type { Database } from "../client";
import { bets } from "../schema";

export function betsRepo(db: Database) {
  return {
    async create(bet: typeof bets.$inferInsert) {
      return db.insert(bets).values(bet);
    },

    async findById(id: string) {
      return db.select().from(bets).where(eq(bets.id, id)).get();
    },

    async findByCompetitor(competitorId: string) {
      return db.select().from(bets).where(eq(bets.competitorId, competitorId)).all();
    },

    async findByStatus(
      status: "pending" | "filled" | "settled_won" | "settled_lost" | "cancelled",
    ) {
      return db.select().from(bets).where(eq(bets.status, status)).all();
    },

    async updateStatus(
      id: string,
      status: "pending" | "filled" | "settled_won" | "settled_lost" | "cancelled",
      settledAt?: Date,
      profit?: number,
    ) {
      return db
        .update(bets)
        .set({ status, settledAt: settledAt ?? null, profit: profit ?? null })
        .where(eq(bets.id, id));
    },

    async getPerformanceStats(competitorId: string) {
      const rows = await db.select().from(bets).where(eq(bets.competitorId, competitorId)).all();

      const wins = rows.filter((r) => r.status === "settled_won").length;
      const losses = rows.filter((r) => r.status === "settled_lost").length;
      const pending = rows.filter((r) => r.status === "pending" || r.status === "filled").length;
      const totalStaked = rows.reduce((sum, r) => sum + r.amount, 0);
      const totalReturned = rows
        .filter((r) => r.profit !== null)
        .reduce((sum, r) => sum + r.amount + (r.profit ?? 0), 0);

      return {
        competitorId,
        totalBets: rows.length,
        wins,
        losses,
        pending,
        totalStaked,
        totalReturned,
        profitLoss: totalReturned - totalStaked,
        accuracy: wins + losses > 0 ? wins / (wins + losses) : 0,
        roi: totalStaked > 0 ? (totalReturned - totalStaked) / totalStaked : 0,
      };
    },
  };
}
