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
  });
});
