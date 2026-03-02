import { beforeEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Database } from "../../../../../src/infrastructure/database/client";
import { fixturesRepo } from "../../../../../src/infrastructure/database/repositories/fixtures";
import * as schema from "../../../../../src/infrastructure/database/schema";

let db: Database;

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  db = drizzle(client, { schema }) as Database;
  await migrate(db, { migrationsFolder: "./drizzle" });
});

const sampleFixture: typeof schema.fixtures.$inferInsert = {
  id: 1001,
  leagueId: 39,
  leagueName: "Premier League",
  leagueCountry: "England",
  leagueSeason: 2025,
  homeTeamId: 42,
  homeTeamName: "Arsenal",
  homeTeamLogo: "https://example.com/arsenal.png",
  awayTeamId: 49,
  awayTeamName: "Chelsea",
  awayTeamLogo: "https://example.com/chelsea.png",
  date: "2026-03-15T15:00:00Z",
  venue: "Emirates Stadium",
  status: "scheduled",
};

describe("fixturesRepo", () => {
  it("inserts and retrieves a fixture", async () => {
    const repo = fixturesRepo(db);
    await repo.upsert(sampleFixture);
    const found = await repo.findById(1001);
    expect(found?.homeTeamName).toBe("Arsenal");
    expect(found?.awayTeamName).toBe("Chelsea");
    expect(found?.venue).toBe("Emirates Stadium");
  });

  it("updates status on conflict", async () => {
    const repo = fixturesRepo(db);
    await repo.upsert(sampleFixture);
    await repo.upsert({ ...sampleFixture, status: "finished" });
    const found = await repo.findById(1001);
    expect(found?.status).toBe("finished");
  });

  it("finds fixtures by status", async () => {
    const repo = fixturesRepo(db);
    await repo.upsert(sampleFixture);
    await repo.upsert({ ...sampleFixture, id: 1002, status: "finished" });
    const scheduled = await repo.findByStatus("scheduled");
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.id).toBe(1001);
  });

  it("returns undefined for missing fixture", async () => {
    const repo = fixturesRepo(db);
    const found = await repo.findById(9999);
    expect(found).toBeUndefined();
  });

  it("finds all fixtures", async () => {
    const repo = fixturesRepo(db);
    await repo.upsert(sampleFixture);
    await repo.upsert({ ...sampleFixture, id: 1002, status: "finished" });
    const all = await repo.findAll();
    expect(all).toHaveLength(2);
  });
});
