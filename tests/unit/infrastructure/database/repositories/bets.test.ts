import { beforeEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Database } from "../../../../../src/infrastructure/database/client";
import { betsRepo } from "../../../../../src/infrastructure/database/repositories/bets";
import * as schema from "../../../../../src/infrastructure/database/schema";

let db: Database;

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  db = drizzle(client, { schema }) as Database;
  await migrate(db, { migrationsFolder: "./drizzle" });

  await db.insert(schema.markets).values({
    id: "market-1",
    conditionId: "cond-1",
    slug: "test",
    question: "Test?",
    outcomes: ["Yes", "No"],
    outcomePrices: ["0.5", "0.5"],
    tokenIds: ["t1", "t2"],
  });
  await db.insert(schema.fixtures).values({
    id: 1001,
    leagueId: 39,
    leagueName: "PL",
    leagueCountry: "England",
    leagueSeason: 2025,
    homeTeamId: 1,
    homeTeamName: "Arsenal",
    awayTeamId: 2,
    awayTeamName: "Chelsea",
    date: "2026-03-15",
  });
  await db.insert(schema.competitors).values({
    id: "claude-1",
    name: "Claude",
    model: "anthropic/claude-sonnet-4",
    enginePath: "src/competitors/claude/engine.ts",
  });
});

const sampleBet: typeof schema.bets.$inferInsert = {
  id: "bet-1",
  orderId: "order-1",
  marketId: "market-1",
  fixtureId: 1001,
  competitorId: "claude-1",
  tokenId: "t1",
  side: "YES",
  amount: 10,
  price: 0.65,
  shares: 15.38,
  status: "pending",
};

describe("betsRepo", () => {
  it("creates and retrieves a bet", async () => {
    const repo = betsRepo(db);
    await repo.create(sampleBet);
    const found = await repo.findById("bet-1");
    expect(found?.orderId).toBe("order-1");
    expect(found?.amount).toBe(10);
    expect(found?.price).toBe(0.65);
  });

  it("finds bets by competitor", async () => {
    const repo = betsRepo(db);
    await repo.create(sampleBet);
    const results = await repo.findByCompetitor("claude-1");
    expect(results).toHaveLength(1);
  });

  it("finds bets by status", async () => {
    const repo = betsRepo(db);
    await repo.create(sampleBet);
    const pending = await repo.findByStatus("pending");
    expect(pending).toHaveLength(1);
    const filled = await repo.findByStatus("filled");
    expect(filled).toHaveLength(0);
  });

  it("updates bet status", async () => {
    const repo = betsRepo(db);
    await repo.create(sampleBet);
    await repo.updateStatus("bet-1", "settled_won", new Date(), 5.38);
    const found = await repo.findById("bet-1");
    expect(found?.status).toBe("settled_won");
    expect(found?.profit).toBe(5.38);
    expect(found?.settledAt).toBeTruthy();
  });

  it("returns undefined for missing bet", async () => {
    const repo = betsRepo(db);
    const found = await repo.findById("nonexistent");
    expect(found).toBeUndefined();
  });

  describe("getPerformanceStats", () => {
    it("computes stats from bets", async () => {
      const repo = betsRepo(db);
      await repo.create(sampleBet);
      await repo.create({ ...sampleBet, id: "bet-2", orderId: "order-2", amount: 5 });

      await repo.updateStatus("bet-1", "settled_won", new Date(), 5.38);
      await repo.updateStatus("bet-2", "settled_lost", new Date(), -5);

      const stats = await repo.getPerformanceStats("claude-1");
      expect(stats.totalBets).toBe(2);
      expect(stats.wins).toBe(1);
      expect(stats.losses).toBe(1);
      expect(stats.pending).toBe(0);
      expect(stats.totalStaked).toBe(15);
      expect(stats.accuracy).toBe(0.5);
    });

    it("returns zeroes for no bets", async () => {
      const repo = betsRepo(db);
      const stats = await repo.getPerformanceStats("claude-1");
      expect(stats.totalBets).toBe(0);
      expect(stats.accuracy).toBe(0);
      expect(stats.roi).toBe(0);
    });

    it("excludes failed bets from P&L and staked totals", async () => {
      const repo = betsRepo(db);
      // Create 3 bets: 1 settled, 2 failed
      await repo.create({ ...sampleBet, id: "bet-s", orderId: "o-s", amount: 10 });
      await repo.create({
        ...sampleBet,
        id: "bet-f1",
        orderId: "o-f1",
        amount: 5,
        status: "failed",
      });
      await repo.create({
        ...sampleBet,
        id: "bet-f2",
        orderId: "o-f2",
        amount: 5,
        status: "failed",
      });

      await repo.updateStatus("bet-s", "settled_won", new Date(), 5);

      const stats = await repo.getPerformanceStats("claude-1");
      expect(stats.totalBets).toBe(3);
      expect(stats.failed).toBe(2);
      // P&L should only reflect the settled bet, not the failed ones
      expect(stats.totalStaked).toBe(10);
      expect(stats.totalReturned).toBe(15); // 10 + 5 profit
      expect(stats.profitLoss).toBe(5);
    });

    it("tracks lockedAmount from pending and filled bets", async () => {
      const repo = betsRepo(db);
      await repo.create({
        ...sampleBet,
        id: "bet-p",
        orderId: "o-p",
        amount: 8,
        status: "pending",
      });
      await repo.create({
        ...sampleBet,
        id: "bet-f",
        orderId: "o-f",
        amount: 12,
        status: "filled",
      });
      await repo.create({ ...sampleBet, id: "bet-x", orderId: "o-x", amount: 5, status: "failed" });

      const stats = await repo.getPerformanceStats("claude-1");
      expect(stats.lockedAmount).toBe(20); // 8 + 12, excludes failed
      expect(stats.pending).toBe(2);
    });
  });

  it("finds all bets", async () => {
    const repo = betsRepo(db);
    await repo.create(sampleBet);
    await repo.create({ ...sampleBet, id: "bet-2", orderId: "order-2" });
    const all = await repo.findAll();
    expect(all).toHaveLength(2);
  });

  it("finds recent bets ordered by placedAt", async () => {
    const repo = betsRepo(db);
    await repo.create(sampleBet);
    await repo.create({ ...sampleBet, id: "bet-2", orderId: "order-2" });
    const recent = await repo.findRecent(1);
    expect(recent).toHaveLength(1);
  });

  describe("new statuses and columns", () => {
    it("creates and retrieves a bet with submitting status", async () => {
      const repo = betsRepo(db);
      await repo.create({
        ...sampleBet,
        status: "submitting",
        orderId: null,
      });
      const found = await repo.findById("bet-1");
      expect(found?.status).toBe("submitting");
    });

    it("creates and retrieves a bet with failed status", async () => {
      const repo = betsRepo(db);
      await repo.create({
        ...sampleBet,
        status: "failed",
        errorMessage: "Connection refused",
        errorCategory: "network_error",
        attempts: 1,
        lastAttemptAt: new Date(),
      });
      const found = await repo.findById("bet-1");
      expect(found?.status).toBe("failed");
      expect(found?.errorMessage).toBe("Connection refused");
      expect(found?.errorCategory).toBe("network_error");
      expect(found?.attempts).toBe(1);
      expect(found?.lastAttemptAt).toBeTruthy();
    });

    it("defaults attempts to 0 and error fields to null", async () => {
      const repo = betsRepo(db);
      await repo.create(sampleBet);
      const found = await repo.findById("bet-1");
      expect(found?.attempts).toBe(0);
      expect(found?.errorMessage).toBeNull();
      expect(found?.errorCategory).toBeNull();
      expect(found?.lastAttemptAt).toBeNull();
    });

    it("finds submitting bets by status", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, status: "submitting", orderId: null });
      const results = await repo.findByStatus("submitting");
      expect(results).toHaveLength(1);
    });

    it("finds failed bets by status", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, status: "failed" });
      const results = await repo.findByStatus("failed");
      expect(results).toHaveLength(1);
    });
  });

  describe("updateBetAfterSubmission", () => {
    it("updates submitting bet to pending with orderId", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, status: "submitting", orderId: null });
      await repo.updateBetAfterSubmission("bet-1", {
        status: "pending",
        orderId: "real-order-123",
      });
      const found = await repo.findById("bet-1");
      expect(found?.status).toBe("pending");
      expect(found?.orderId).toBe("real-order-123");
    });

    it("updates submitting bet to failed with error details", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, status: "submitting", orderId: null });
      const now = new Date();
      await repo.updateBetAfterSubmission("bet-1", {
        status: "failed",
        errorMessage: "Connection refused",
        errorCategory: "network_error",
        attempts: 1,
        lastAttemptAt: now,
      });
      const found = await repo.findById("bet-1");
      expect(found?.status).toBe("failed");
      expect(found?.errorMessage).toBe("Connection refused");
      expect(found?.errorCategory).toBe("network_error");
      expect(found?.attempts).toBe(1);
      expect(found?.lastAttemptAt).toBeTruthy();
    });
  });

  describe("findRetryableBets", () => {
    it("returns failed bets with retryable category under max attempts", async () => {
      const repo = betsRepo(db);
      await repo.create({
        ...sampleBet,
        status: "failed",
        errorCategory: "network_error",
        attempts: 1,
      });
      const retryable = await repo.findRetryableBets(3);
      expect(retryable).toHaveLength(1);
    });

    it("excludes terminal category bets", async () => {
      const repo = betsRepo(db);
      await repo.create({
        ...sampleBet,
        id: "bet-terminal",
        orderId: "order-t",
        status: "failed",
        errorCategory: "insufficient_funds",
        attempts: 1,
      });
      const retryable = await repo.findRetryableBets(3);
      expect(retryable).toHaveLength(0);
    });

    it("excludes bets at or over max attempts", async () => {
      const repo = betsRepo(db);
      await repo.create({
        ...sampleBet,
        status: "failed",
        errorCategory: "network_error",
        attempts: 3,
      });
      const retryable = await repo.findRetryableBets(3);
      expect(retryable).toHaveLength(0);
    });

    it("includes rate_limited and excludes wallet_error", async () => {
      const repo = betsRepo(db);
      await repo.create({
        ...sampleBet,
        id: "bet-rate",
        orderId: "order-r",
        status: "failed",
        errorCategory: "rate_limited",
        attempts: 1,
      });
      await repo.create({
        ...sampleBet,
        id: "bet-wallet",
        orderId: "order-w",
        status: "failed",
        errorCategory: "wallet_error",
        attempts: 1,
      });
      const retryable = await repo.findRetryableBets(3);
      expect(retryable).toHaveLength(1);
      expect(retryable[0]?.id).toBe("bet-rate");
    });
  });
});
