import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notInArray,
  sql,
} from "drizzle-orm";
import type { BetErrorCategory, BetStatus } from "../../domain/models/prediction.ts";
import { ACTIVE_BET_STATUSES } from "../../domain/models/prediction.ts";
import type { Database } from "../client";
import { bets } from "../schema";

const TERMINAL_CATEGORIES: BetErrorCategory[] = [
  "insufficient_funds",
  "wallet_error",
  "invalid_market",
  "geo_restricted",
];

type BetRow = typeof bets.$inferSelect;

type PerformanceStats = {
  competitorId: string;
  totalBets: number;
  wins: number;
  losses: number;
  pending: number;
  failed: number;
  lockedAmount: number;
  totalStaked: number;
  totalReturned: number;
  profitLoss: number;
  accuracy: number;
  roi: number;
};

function computeStats(competitorId: string, rows: BetRow[]): PerformanceStats {
  const settled = rows.filter((r) => r.status === "settled_won" || r.status === "settled_lost");
  const wins = rows.filter((r) => r.status === "settled_won").length;
  const losses = rows.filter((r) => r.status === "settled_lost").length;
  const activeStatuses = new Set<string>(ACTIVE_BET_STATUSES);
  const pending = rows.filter((r) => activeStatuses.has(r.status)).length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const activeBets = rows.filter((r) => r.status === "pending" || r.status === "filled");
  const lockedAmount = activeBets.reduce((sum, r) => sum + r.amount, 0);

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
}

export function betsRepo(db: Database) {
  return {
    async create(bet: typeof bets.$inferInsert) {
      return db.insert(bets).values(bet).run();
    },

    // Atomic insert-if-no-active-bet using raw SQL because Drizzle doesn't support
    // INSERT...SELECT...WHERE NOT EXISTS. Column list must stay in sync with the bets schema.
    async createIfNoActiveBet(bet: typeof bets.$inferInsert): Promise<"created" | "duplicate"> {
      const placedAt = bet.placedAt ?? new Date();
      const statusList = ACTIVE_BET_STATUSES.map((s) => `'${s}'`).join(", ");
      const result = await db.run(sql`
        INSERT INTO bets (id, order_id, market_id, fixture_id, competitor_id, token_id, side, amount, price, shares, status, placed_at, attempts)
        SELECT ${bet.id}, ${bet.orderId ?? null}, ${bet.marketId}, ${bet.fixtureId}, ${bet.competitorId}, ${bet.tokenId}, ${bet.side}, ${bet.amount}, ${bet.price}, ${bet.shares}, ${bet.status}, ${Math.floor(placedAt.getTime() / 1000)}, ${bet.attempts ?? 0}
        WHERE NOT EXISTS (
          SELECT 1 FROM bets
          WHERE market_id = ${bet.marketId} AND competitor_id = ${bet.competitorId}
          AND status IN (${sql.raw(statusList)})
        )
      `);
      return result.rowsAffected > 0 ? "created" : "duplicate";
    },

    async hasActiveBetForMarket(marketId: string, competitorId: string): Promise<boolean> {
      const row = await db
        .select({ id: bets.id })
        .from(bets)
        .where(
          and(
            eq(bets.marketId, marketId),
            eq(bets.competitorId, competitorId),
            inArray(bets.status, [...ACTIVE_BET_STATUSES]),
          ),
        )
        .get();

      return row !== undefined;
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

    async findByFixtureId(fixtureId: number) {
      return db.select().from(bets).where(eq(bets.fixtureId, fixtureId)).all();
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

    async updateAmount(id: string, newAmount: number) {
      const bet = await db.select().from(bets).where(eq(bets.id, id)).get();
      if (!bet) return;
      if (!Number.isFinite(bet.price) || bet.price <= 0) return;
      const newShares = newAmount / bet.price;
      return db
        .update(bets)
        .set({ amount: newAmount, shares: newShares })
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

    async findPlacedInRange(start: Date, end: Date) {
      return db
        .select()
        .from(bets)
        .where(and(gte(bets.placedAt, start), lte(bets.placedAt, end)))
        .all();
    },

    async findSettledInRange(start: Date, end: Date) {
      return db
        .select()
        .from(bets)
        .where(and(isNotNull(bets.settledAt), gte(bets.settledAt, start), lte(bets.settledAt, end)))
        .all();
    },

    async getPerformanceStats(competitorId: string) {
      const rows = await db.select().from(bets).where(eq(bets.competitorId, competitorId)).all();
      return computeStats(competitorId, rows);
    },

    async getAllPerformanceStats() {
      const rows = await db.select().from(bets).all();

      const byCompetitor = new Map<string, BetRow[]>();
      for (const row of rows) {
        const existing = byCompetitor.get(row.competitorId) ?? [];
        existing.push(row);
        byCompetitor.set(row.competitorId, existing);
      }

      const result = new Map<string, PerformanceStats>();
      for (const [competitorId, competitorRows] of byCompetitor) {
        result.set(competitorId, computeStats(competitorId, competitorRows));
      }
      return result;
    },

    async findUnredeemedWins() {
      return db
        .select()
        .from(bets)
        .where(and(eq(bets.status, "settled_won"), isNull(bets.redeemedAt)))
        .all();
    },

    async markRedeemed(id: string, txHash: string, redeemedAt: Date) {
      await db
        .update(bets)
        .set({ redemptionTxHash: txHash, redeemedAt })
        .where(eq(bets.id, id))
        .run();
    },
  };
}
