import { beforeEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Database } from "../../../../src/database/client";
import { predictionsRepo } from "../../../../src/database/repositories/predictions";
import * as schema from "../../../../src/database/schema";

let db: Database;

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  db = drizzle(client, { schema }) as Database;
  await migrate(db, { migrationsFolder: "./drizzle" });

  // Insert required foreign key references
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

describe("predictionsRepo", () => {
  const samplePrediction: typeof schema.predictions.$inferInsert = {
    marketId: "market-1",
    fixtureId: 1001,
    competitorId: "claude-1",
    side: "YES",
    confidence: 0.75,
    stake: 5.0,
    reasoning: {
      summary: "Strong home form",
      sections: [{ label: "Analysis", content: "Strong home form" }],
    },
  };

  it("creates and finds by competitor", async () => {
    const repo = predictionsRepo(db);
    await repo.create(samplePrediction);
    const results = await repo.findByCompetitor("claude-1");
    expect(results).toHaveLength(1);
    expect(results[0]?.side).toBe("YES");
    expect(results[0]?.confidence).toBe(0.75);
  });

  it("finds by market", async () => {
    const repo = predictionsRepo(db);
    await repo.create(samplePrediction);
    const results = await repo.findByMarket("market-1");
    expect(results).toHaveLength(1);
  });

  it("finds by fixture and competitor", async () => {
    const repo = predictionsRepo(db);
    await repo.create(samplePrediction);
    const results = await repo.findByFixtureAndCompetitor(1001, "claude-1");
    expect(results).toHaveLength(1);
    expect(results[0]?.reasoning).toEqual({
      summary: "Strong home form",
      sections: [{ label: "Analysis", content: "Strong home form" }],
    });
  });

  it("returns empty array for no matches", async () => {
    const repo = predictionsRepo(db);
    const results = await repo.findByCompetitor("nonexistent");
    expect(results).toHaveLength(0);
  });

  it("finds all predictions", async () => {
    const repo = predictionsRepo(db);
    await repo.create(samplePrediction);
    const all = await repo.findAll();
    expect(all).toHaveLength(1);
  });

  it("finds recent predictions with limit", async () => {
    const repo = predictionsRepo(db);
    await repo.create(samplePrediction);
    await repo.create({ ...samplePrediction, confidence: 0.5 });
    const recent = await repo.findRecent(1);
    expect(recent).toHaveLength(1);
  });

  describe("addStakeAdjustment", () => {
    it("updates the prediction with adjustment JSON", async () => {
      const repo = predictionsRepo(db);
      await repo.create(samplePrediction);

      const adjustment = {
        originalStake: 0.31,
        adjustedStake: 1,
        reason: "min_bet_bump",
        minSizeFromError: 1,
        adjustedAt: "2026-03-05T00:00:00.000Z",
      };

      await repo.addStakeAdjustment("market-1", "claude-1", adjustment);

      const results = await repo.findByCompetitor("claude-1");
      expect(results).toHaveLength(1);
      expect((results[0] as any).stakeAdjustment).toEqual(adjustment);
    });

    it("is a no-op on non-existent prediction", async () => {
      const repo = predictionsRepo(db);
      await repo.addStakeAdjustment("nonexistent", "nonexistent", {
        originalStake: 0.31,
        adjustedStake: 1,
        reason: "min_bet_bump",
        minSizeFromError: 1,
        adjustedAt: "2026-03-05T00:00:00.000Z",
      });
      // No error thrown
    });
  });
});
