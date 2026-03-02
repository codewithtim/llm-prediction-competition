import { beforeEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Database } from "../../../../../src/infrastructure/database/client";
import { marketsRepo } from "../../../../../src/infrastructure/database/repositories/markets";
import * as schema from "../../../../../src/infrastructure/database/schema";

let db: Database;

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  db = drizzle(client, { schema }) as Database;
  await migrate(db, { migrationsFolder: "./drizzle" });
});

const sampleMarket: typeof schema.markets.$inferInsert = {
  id: "market-1",
  conditionId: "cond-1",
  slug: "arsenal-vs-chelsea",
  question: "Will Arsenal win?",
  outcomes: ["Yes", "No"],
  outcomePrices: ["0.65", "0.35"],
  tokenIds: ["token-yes", "token-no"],
  active: true,
  closed: false,
  acceptingOrders: true,
  liquidity: 50000,
  volume: 120000,
  gameId: "game-123",
  sportsMarketType: "moneyline",
  line: null,
};

describe("marketsRepo", () => {
  it("inserts and retrieves a market", async () => {
    const repo = marketsRepo(db);
    await repo.upsert(sampleMarket);
    const found = await repo.findById("market-1");
    expect(found?.question).toBe("Will Arsenal win?");
    expect(found?.outcomes).toEqual(["Yes", "No"]);
    expect(found?.tokenIds).toEqual(["token-yes", "token-no"]);
  });

  it("updates on conflict", async () => {
    const repo = marketsRepo(db);
    await repo.upsert(sampleMarket);
    await repo.upsert({ ...sampleMarket, liquidity: 99999 });
    const found = await repo.findById("market-1");
    expect(found?.liquidity).toBe(99999);
  });

  it("finds active markets", async () => {
    const repo = marketsRepo(db);
    await repo.upsert(sampleMarket);
    await repo.upsert({ ...sampleMarket, id: "market-2", active: false });
    const active = await repo.findActive();
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe("market-1");
  });

  it("finds markets by gameId", async () => {
    const repo = marketsRepo(db);
    await repo.upsert(sampleMarket);
    await repo.upsert({ ...sampleMarket, id: "market-2", gameId: "game-456" });
    const results = await repo.findByGameId("game-123");
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("market-1");
  });

  it("returns undefined for missing market", async () => {
    const repo = marketsRepo(db);
    const found = await repo.findById("nonexistent");
    expect(found).toBeUndefined();
  });

  it("finds all markets", async () => {
    const repo = marketsRepo(db);
    await repo.upsert(sampleMarket);
    await repo.upsert({ ...sampleMarket, id: "market-2" });
    const all = await repo.findAll();
    expect(all).toHaveLength(2);
  });
});
