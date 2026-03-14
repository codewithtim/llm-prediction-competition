import { beforeEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Database } from "../../../../src/database/client";
import { betsRepo } from "../../../../src/database/repositories/bets";
import * as schema from "../../../../src/database/schema";

let db: Database;

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  db = drizzle(client, { schema }) as Database;
  await migrate(db, { migrationsFolder: "./drizzle" });

  await db.insert(schema.markets).values([
    {
      id: "market-1",
      conditionId: "cond-1",
      slug: "test",
      question: "Test?",
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.5", "0.5"],
      tokenIds: ["t1", "t2"],
    },
    {
      id: "market-2",
      conditionId: "cond-2",
      slug: "test-2",
      question: "Test 2?",
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.5", "0.5"],
      tokenIds: ["t3", "t4"],
    },
  ]);
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
      await repo.create({ ...sampleBet, id: "bet-2", orderId: "order-2", marketId: "market-2", amount: 5 });

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
        marketId: "market-2",
        amount: 12,
        status: "filled",
      });
      await repo.create({ ...sampleBet, id: "bet-x", orderId: "o-x", amount: 5, status: "failed" });

      const stats = await repo.getPerformanceStats("claude-1");
      expect(stats.lockedAmount).toBe(20); // 8 + 12, excludes failed
      expect(stats.pending).toBe(2);
    });
  });

  describe("getAllPerformanceStats", () => {
    it("returns empty map when no bets exist", async () => {
      const repo = betsRepo(db);
      const result = await repo.getAllPerformanceStats();
      expect(result.size).toBe(0);
    });

    it("groups stats by competitor", async () => {
      await db.insert(schema.competitors).values({
        id: "gpt-1",
        name: "GPT",
        model: "openai/gpt-4",
        enginePath: "src/competitors/gpt/engine.ts",
      });

      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, id: "bet-c1", orderId: "o-c1", amount: 10 });
      await repo.create({
        ...sampleBet,
        id: "bet-c2",
        orderId: "o-c2",
        competitorId: "gpt-1",
        amount: 20,
      });

      await repo.updateStatus("bet-c1", "settled_won", new Date(), 5);
      await repo.updateStatus("bet-c2", "settled_lost", new Date(), -20);

      const result = await repo.getAllPerformanceStats();
      expect(result.size).toBe(2);

      const claude = result.get("claude-1");
      expect(claude?.wins).toBe(1);
      expect(claude?.losses).toBe(0);
      expect(claude?.totalStaked).toBe(10);
      expect(claude?.profitLoss).toBe(5);

      const gpt = result.get("gpt-1");
      expect(gpt?.wins).toBe(0);
      expect(gpt?.losses).toBe(1);
      expect(gpt?.totalStaked).toBe(20);
      expect(gpt?.profitLoss).toBe(-20);
    });

    it("matches single-competitor getPerformanceStats", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, id: "bet-1", orderId: "o-1", amount: 10 });
      await repo.create({
        ...sampleBet,
        id: "bet-2",
        orderId: "o-2",
        marketId: "market-2",
        amount: 5,
      });
      await repo.updateStatus("bet-1", "settled_won", new Date(), 5);
      await repo.updateStatus("bet-2", "settled_lost", new Date(), -5);

      const singleStats = await repo.getPerformanceStats("claude-1");
      const allStats = await repo.getAllPerformanceStats();
      const fromAll = allStats.get("claude-1");

      expect(fromAll?.totalBets).toBe(singleStats.totalBets);
      expect(fromAll?.wins).toBe(singleStats.wins);
      expect(fromAll?.losses).toBe(singleStats.losses);
      expect(fromAll?.pending).toBe(singleStats.pending);
      expect(fromAll?.failed).toBe(singleStats.failed);
      expect(fromAll?.lockedAmount).toBe(singleStats.lockedAmount);
      expect(fromAll?.totalStaked).toBe(singleStats.totalStaked);
      expect(fromAll?.totalReturned).toBe(singleStats.totalReturned);
      expect(fromAll?.profitLoss).toBe(singleStats.profitLoss);
      expect(fromAll?.accuracy).toBe(singleStats.accuracy);
      expect(fromAll?.roi).toBe(singleStats.roi);
    });

    it("includes pending and failed counts", async () => {
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
        marketId: "market-2",
        amount: 5,
        status: "failed",
      });

      const result = await repo.getAllPerformanceStats();
      const stats = result.get("claude-1");
      expect(stats?.totalBets).toBe(2);
      expect(stats?.pending).toBe(1);
      expect(stats?.failed).toBe(1);
      expect(stats?.lockedAmount).toBe(8);
    });
  });

  it("finds all bets", async () => {
    const repo = betsRepo(db);
    await repo.create(sampleBet);
    await repo.create({ ...sampleBet, id: "bet-2", orderId: "order-2", marketId: "market-2" });
    const all = await repo.findAll();
    expect(all).toHaveLength(2);
  });

  it("finds recent bets ordered by placedAt", async () => {
    const repo = betsRepo(db);
    await repo.create(sampleBet);
    await repo.create({ ...sampleBet, id: "bet-2", orderId: "order-2", marketId: "market-2" });
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

  describe("createIfNoActiveBet", () => {
    it("creates bet when no active bet exists", async () => {
      const repo = betsRepo(db);
      const result = await repo.createIfNoActiveBet({
        ...sampleBet,
        id: "new-bet",
        orderId: null,
        status: "submitting",
      });
      expect(result).toBe("created");
      const found = await repo.findById("new-bet");
      expect(found).toBeDefined();
      expect(found?.status).toBe("submitting");
    });

    it("returns duplicate when submitting bet exists for same market+competitor", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, id: "existing", orderId: null, status: "submitting" });

      const result = await repo.createIfNoActiveBet({
        ...sampleBet,
        id: "new-bet",
        orderId: null,
        status: "submitting",
      });

      expect(result).toBe("duplicate");
      const all = await repo.findAll();
      expect(all).toHaveLength(1);
      expect(all[0]?.id).toBe("existing");
    });

    it("returns duplicate when pending bet exists for same market+competitor", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, id: "existing", status: "pending" });

      const result = await repo.createIfNoActiveBet({
        ...sampleBet,
        id: "new-bet",
        orderId: null,
        status: "submitting",
      });

      expect(result).toBe("duplicate");
      const all = await repo.findAll();
      expect(all).toHaveLength(1);
    });

    it("returns duplicate when filled bet exists for same market+competitor", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, id: "existing", status: "filled" });

      const result = await repo.createIfNoActiveBet({
        ...sampleBet,
        id: "new-bet",
        orderId: null,
        status: "submitting",
      });

      expect(result).toBe("duplicate");
      const all = await repo.findAll();
      expect(all).toHaveLength(1);
    });

    it("allows bet when existing bet is failed", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, id: "failed-bet", status: "failed" });

      const result = await repo.createIfNoActiveBet({
        ...sampleBet,
        id: "new-bet",
        orderId: null,
        status: "submitting",
      });

      expect(result).toBe("created");
      const all = await repo.findAll();
      expect(all).toHaveLength(2);
    });

    it("allows bet when existing bet is settled_won", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, id: "settled-bet", status: "settled_won" });

      const result = await repo.createIfNoActiveBet({
        ...sampleBet,
        id: "new-bet",
        orderId: null,
        status: "submitting",
      });

      expect(result).toBe("created");
      const all = await repo.findAll();
      expect(all).toHaveLength(2);
    });

    it("allows bet when existing bet is settled_lost", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, id: "settled-bet", status: "settled_lost" });

      const result = await repo.createIfNoActiveBet({
        ...sampleBet,
        id: "new-bet",
        orderId: null,
        status: "submitting",
      });

      expect(result).toBe("created");
    });

    it("allows bet when existing bet is cancelled", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, id: "cancelled-bet", status: "cancelled" });

      const result = await repo.createIfNoActiveBet({
        ...sampleBet,
        id: "new-bet",
        orderId: null,
        status: "submitting",
      });

      expect(result).toBe("created");
    });

    it("allows bet for different market same competitor", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, id: "existing", status: "pending" });

      const result = await repo.createIfNoActiveBet({
        ...sampleBet,
        id: "new-bet",
        marketId: "market-2",
        orderId: null,
        status: "submitting",
      });

      expect(result).toBe("created");
    });

    it("allows bet for same market different competitor", async () => {
      const repo = betsRepo(db);
      await db.insert(schema.competitors).values({
        id: "gpt-1",
        name: "GPT",
        model: "openai/gpt-4",
        enginePath: "src/competitors/gpt/engine.ts",
      });
      await repo.create({ ...sampleBet, id: "existing", status: "pending" });

      const result = await repo.createIfNoActiveBet({
        ...sampleBet,
        id: "new-bet",
        competitorId: "gpt-1",
        orderId: null,
        status: "submitting",
      });

      expect(result).toBe("created");
    });
  });

  describe("hasActiveBetForMarket", () => {
    it("returns true when submitting bet exists", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, orderId: null, status: "submitting" });
      expect(await repo.hasActiveBetForMarket("market-1", "claude-1")).toBe(true);
    });

    it("returns true when pending bet exists", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, status: "pending" });
      expect(await repo.hasActiveBetForMarket("market-1", "claude-1")).toBe(true);
    });

    it("returns true when filled bet exists", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, status: "filled" });
      expect(await repo.hasActiveBetForMarket("market-1", "claude-1")).toBe(true);
    });

    it("returns false when no bet exists", async () => {
      const repo = betsRepo(db);
      expect(await repo.hasActiveBetForMarket("market-1", "claude-1")).toBe(false);
    });

    it("returns false when only failed bets exist", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, status: "failed" });
      expect(await repo.hasActiveBetForMarket("market-1", "claude-1")).toBe(false);
    });

    it("returns false when only settled bets exist", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, status: "settled_won" });
      expect(await repo.hasActiveBetForMarket("market-1", "claude-1")).toBe(false);
    });

    it("returns false when only cancelled bets exist", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, status: "cancelled" });
      expect(await repo.hasActiveBetForMarket("market-1", "claude-1")).toBe(false);
    });

    it("returns false for different market", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, status: "pending" });
      expect(await repo.hasActiveBetForMarket("market-other", "claude-1")).toBe(false);
    });

    it("returns false for different competitor", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, status: "pending" });
      expect(await repo.hasActiveBetForMarket("market-1", "other-competitor")).toBe(false);
    });
  });

  describe("updateAmount", () => {
    it("updates amount and recalculates shares", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, id: "bet-ua", orderId: "order-ua", amount: 5, price: 0.5, shares: 10 });
      await repo.updateAmount("bet-ua", 10);
      const found = await repo.findById("bet-ua");
      expect(found?.amount).toBe(10);
      expect(found?.shares).toBe(20);
    });

    it("is a no-op for non-existent bet", async () => {
      const repo = betsRepo(db);
      await repo.updateAmount("nonexistent", 10);
      // No error thrown
    });
  });

  describe("findRetryableBets with order_too_small", () => {
    it("returns order_too_small bets (no longer terminal)", async () => {
      const repo = betsRepo(db);
      await repo.create({
        ...sampleBet,
        id: "bet-ots",
        orderId: "order-ots",
        status: "failed",
        errorCategory: "order_too_small",
        attempts: 1,
      });
      const retryable = await repo.findRetryableBets(3);
      expect(retryable).toHaveLength(1);
      expect(retryable[0]?.id).toBe("bet-ots");
    });
  });

  describe("findPlacedInRange", () => {
    it("returns only bets placed within date range", async () => {
      const repo = betsRepo(db);
      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

      await repo.create({ ...sampleBet, id: "bet-recent", orderId: "o-r", placedAt: now });
      await repo.create({ ...sampleBet, id: "bet-old", orderId: "o-o", marketId: "market-2", placedAt: tenDaysAgo });

      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const results = await repo.findPlacedInRange(threeDaysAgo, now);
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe("bet-recent");
    });

    it("returns empty array when no bets in range", async () => {
      const repo = betsRepo(db);
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const farFuture = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const results = await repo.findPlacedInRange(future, farFuture);
      expect(results).toHaveLength(0);
    });
  });

  describe("findSettledInRange", () => {
    it("returns only settled bets within date range", async () => {
      const repo = betsRepo(db);
      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

      await repo.create({ ...sampleBet, id: "bet-settled-recent", orderId: "o-sr" });
      await repo.updateStatus("bet-settled-recent", "settled_won", now, 5);

      await repo.create({ ...sampleBet, id: "bet-settled-old", orderId: "o-so", marketId: "market-2" });
      await repo.updateStatus("bet-settled-old", "settled_lost", tenDaysAgo, -5);

      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const results = await repo.findSettledInRange(threeDaysAgo, now);
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe("bet-settled-recent");
    });

    it("excludes unsettled bets", async () => {
      const repo = betsRepo(db);
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      await repo.create({ ...sampleBet, id: "bet-pending", orderId: "o-p", status: "pending" });
      const results = await repo.findSettledInRange(weekAgo, now);
      expect(results).toHaveLength(0);
    });
  });

  describe("unique index: idx_bets_active_market_competitor", () => {
    it("rejects duplicate active bet at DB level", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, id: "bet-1", status: "pending" });

      await expect(
        repo.create({ ...sampleBet, id: "bet-2", orderId: "order-2", status: "pending" }),
      ).rejects.toThrow();
    });

    it("allows two bets on same market if first is failed", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, id: "bet-1", status: "failed" });
      await repo.create({ ...sampleBet, id: "bet-2", status: "pending" });

      const all = await repo.findAll();
      expect(all).toHaveLength(2);
    });

    it("allows two bets on same market if first is settled", async () => {
      const repo = betsRepo(db);
      await repo.create({ ...sampleBet, id: "bet-1", status: "settled_won" });
      await repo.create({ ...sampleBet, id: "bet-2", status: "pending" });

      const all = await repo.findAll();
      expect(all).toHaveLength(2);
    });
  });
});
