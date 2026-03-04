import { beforeEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Database } from "../../../../src/database/client";
import { auditLogRepo } from "../../../../src/database/repositories/audit-log";
import * as schema from "../../../../src/database/schema";

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
    id: "comp-1",
    name: "Test",
    model: "test-model",
  });
  await db.insert(schema.bets).values({
    id: "bet-1",
    marketId: "market-1",
    fixtureId: 1001,
    competitorId: "comp-1",
    tokenId: "t1",
    side: "YES",
    amount: 5,
    price: 0.5,
    shares: 10,
    status: "pending",
  });
});

describe("auditLogRepo", () => {
  it("records and retrieves audit entries by betId", async () => {
    const repo = auditLogRepo(db);

    await repo.record({
      betId: "bet-1",
      event: "bet_created",
      statusBefore: null,
      statusAfter: "submitting",
    });
    await repo.record({
      betId: "bet-1",
      event: "order_submitted",
      statusBefore: "submitting",
      statusAfter: "pending",
      orderId: "order-abc",
    });

    const entries = await repo.findByBetId("bet-1");

    expect(entries).toHaveLength(2);
    expect(entries[0]!.event).toBe("bet_created");
    expect(entries[0]!.statusBefore).toBeNull();
    expect(entries[0]!.statusAfter).toBe("submitting");
    expect(entries[1]!.event).toBe("order_submitted");
    expect(entries[1]!.orderId).toBe("order-abc");
  });

  it("returns empty array for unknown betId", async () => {
    const repo = auditLogRepo(db);
    const entries = await repo.findByBetId("nonexistent");
    expect(entries).toHaveLength(0);
  });

  it("safeRecord does not throw on failure", async () => {
    const repo = auditLogRepo(db);

    await repo.safeRecord({
      betId: "nonexistent-bet",
      event: "bet_created",
      statusBefore: null,
      statusAfter: "submitting",
    });
  });

  it("stores metadata as JSON", async () => {
    const repo = auditLogRepo(db);

    await repo.record({
      betId: "bet-1",
      event: "bet_settled",
      statusBefore: "filled",
      statusAfter: "settled_won",
      metadata: { outcome: "won", profit: 2.5, winningSide: "YES" },
    });

    const entries = await repo.findByBetId("bet-1");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.metadata).toEqual({ outcome: "won", profit: 2.5, winningSide: "YES" });
  });

  it("stores error and errorCategory", async () => {
    const repo = auditLogRepo(db);

    await repo.record({
      betId: "bet-1",
      event: "order_failed",
      statusBefore: "submitting",
      statusAfter: "failed",
      error: "Connection refused",
      errorCategory: "network_error",
    });

    const entries = await repo.findByBetId("bet-1");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.error).toBe("Connection refused");
    expect(entries[0]!.errorCategory).toBe("network_error");
  });

  it("orders entries by timestamp", async () => {
    const repo = auditLogRepo(db);

    await repo.record({
      betId: "bet-1",
      event: "bet_created",
      statusBefore: null,
      statusAfter: "submitting",
      timestamp: new Date("2026-01-01T00:00:00Z"),
    });
    await repo.record({
      betId: "bet-1",
      event: "order_submitted",
      statusBefore: "submitting",
      statusAfter: "pending",
      timestamp: new Date("2026-01-01T00:01:00Z"),
    });
    await repo.record({
      betId: "bet-1",
      event: "order_confirmed",
      statusBefore: "pending",
      statusAfter: "filled",
      timestamp: new Date("2026-01-01T00:02:00Z"),
    });

    const entries = await repo.findByBetId("bet-1");
    expect(entries).toHaveLength(3);
    expect(entries[0]!.event).toBe("bet_created");
    expect(entries[1]!.event).toBe("order_submitted");
    expect(entries[2]!.event).toBe("order_confirmed");
  });
});
