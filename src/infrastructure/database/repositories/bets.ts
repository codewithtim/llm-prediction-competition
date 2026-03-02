import { and, desc, eq, lt, notInArray } from "drizzle-orm";
import type { BetErrorCategory, BetStatus } from "../../../domain/models/prediction.ts";
import type { Database } from "../client";
import { bets } from "../schema";

const TERMINAL_CATEGORIES: BetErrorCategory[] = [
  "insufficient_funds",
  "wallet_error",
  "invalid_market",
];

export function betsRepo(db: Database) {
  return {
    async create(bet: typeof bets.$inferInsert) {
      return db.insert(bets).values(bet).run();
    },

    async findById(id: string) {
      return db.select().from(bets).where(eq(bets.id, id)).get();
    },

    async findAll() {
      return db.select().from(bets).all();
    },

    async findRecent(limit: number) {
      return db.select().from(bets).orderBy(desc(bets.placedAt)).limit(limit).all();
    },

    async findByCompetitor(competitorId: string) {
      return db.select().from(bets).where(eq(bets.competitorId, competitorId)).all();
    },

    async findByStatus(status: BetStatus) {
      return db.select().from(bets).where(eq(bets.status, status)).all();
    },

    async updateStatus(id: string, status: BetStatus, settledAt?: Date, profit?: number) {
      return db
        .update(bets)
        .set({ status, settledAt: settledAt ?? null, profit: profit ?? null })
        .where(eq(bets.id, id))
        .run();
    },

    async updateBetAfterSubmission(
      id: string,
      update:
        | { status: "pending"; orderId: string }
        | {
            status: "failed";
            errorMessage: string;
            errorCategory: BetErrorCategory;
            attempts: number;
            lastAttemptAt: Date;
          },
    ) {
      if (update.status === "pending") {
        return db
          .update(bets)
          .set({ status: "pending", orderId: update.orderId })
          .where(eq(bets.id, id))
          .run();
      }
      return db
        .update(bets)
        .set({
          status: "failed",
          errorMessage: update.errorMessage,
          errorCategory: update.errorCategory,
          attempts: update.attempts,
          lastAttemptAt: update.lastAttemptAt,
        })
        .where(eq(bets.id, id))
        .run();
    },

    async findRetryableBets(maxAttempts: number, minRetryDelayMs?: number) {
      const conditions = [
        eq(bets.status, "failed"),
        lt(bets.attempts, maxAttempts),
        notInArray(bets.errorCategory, TERMINAL_CATEGORIES),
      ];

      if (minRetryDelayMs) {
        const threshold = new Date(Date.now() - minRetryDelayMs);
        conditions.push(lt(bets.lastAttemptAt, threshold));
      }

      return db
        .select()
        .from(bets)
        .where(and(...conditions))
        .all();
    },

    async getPerformanceStats(competitorId: string) {
      const rows = await db.select().from(bets).where(eq(bets.competitorId, competitorId)).all();

      const settled = rows.filter((r) => r.status === "settled_won" || r.status === "settled_lost");
      const wins = rows.filter((r) => r.status === "settled_won").length;
      const losses = rows.filter((r) => r.status === "settled_lost").length;
      const pending = rows.filter(
        (r) => r.status === "submitting" || r.status === "pending" || r.status === "filled",
      ).length;
      const failed = rows.filter((r) => r.status === "failed").length;
      const activeBets = rows.filter((r) => r.status === "pending" || r.status === "filled");
      const lockedAmount = activeBets.reduce((sum, r) => sum + r.amount, 0);

      // P&L only from settled bets — failed/cancelled bets never used real money
      const totalStaked = settled.reduce((sum, r) => sum + r.amount, 0);
      const totalReturned = settled.reduce((sum, r) => sum + r.amount + (r.profit ?? 0), 0);

      return {
        competitorId,
        totalBets: rows.length,
        wins,
        losses,
        pending,
        failed,
        lockedAmount,
        totalStaked,
        totalReturned,
        profitLoss: totalReturned - totalStaked,
        accuracy: wins + losses > 0 ? wins / (wins + losses) : 0,
        roi: totalStaked > 0 ? (totalReturned - totalStaked) / totalStaked : 0,
      };
    },
  };
}
