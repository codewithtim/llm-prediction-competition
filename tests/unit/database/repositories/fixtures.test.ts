import { beforeEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Database } from "../../../../src/database/client";
import { fixturesRepo } from "../../../../src/database/repositories/fixtures";
import * as schema from "../../../../src/database/schema";

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

  describe("findReadyForPrediction", () => {
    const THIRTY_MINUTES = 30 * 60 * 1000;

    function futureDate(ms: number): string {
      return new Date(Date.now() + ms).toISOString().replace(/\.\d{3}Z$/, "Z");
    }

    function pastDate(ms: number): string {
      return new Date(Date.now() - ms).toISOString().replace(/\.\d{3}Z$/, "Z");
    }

    it("returns fixtures within lead time", async () => {
      const repo = fixturesRepo(db);
      await repo.upsert({ ...sampleFixture, date: futureDate(15 * 60 * 1000) });
      const results = await repo.findReadyForPrediction(THIRTY_MINUTES);
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(1001);
    });

    it("excludes fixtures too far ahead", async () => {
      const repo = fixturesRepo(db);
      await repo.upsert({ ...sampleFixture, date: futureDate(2 * 60 * 60 * 1000) });
      const results = await repo.findReadyForPrediction(THIRTY_MINUTES);
      expect(results).toHaveLength(0);
    });

    it("excludes past fixtures", async () => {
      const repo = fixturesRepo(db);
      await repo.upsert({ ...sampleFixture, date: pastDate(60 * 60 * 1000) });
      const results = await repo.findReadyForPrediction(THIRTY_MINUTES);
      expect(results).toHaveLength(0);
    });

    it("excludes non-scheduled fixtures", async () => {
      const repo = fixturesRepo(db);
      await repo.upsert({ ...sampleFixture, date: futureDate(15 * 60 * 1000), status: "in_progress" });
      const results = await repo.findReadyForPrediction(THIRTY_MINUTES);
      expect(results).toHaveLength(0);
    });
  });

  describe("findNeedingStatusUpdate", () => {
    function pastDate(ms: number): string {
      return new Date(Date.now() - ms).toISOString().replace(/\.\d{3}Z$/, "Z");
    }

    function futureDate(ms: number): string {
      return new Date(Date.now() + ms).toISOString().replace(/\.\d{3}Z$/, "Z");
    }

    it("returns past scheduled fixtures", async () => {
      const repo = fixturesRepo(db);
      await repo.upsert({ ...sampleFixture, date: pastDate(60 * 60 * 1000) });
      const results = await repo.findNeedingStatusUpdate();
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(1001);
    });

    it("returns in_progress fixtures", async () => {
      const repo = fixturesRepo(db);
      await repo.upsert({ ...sampleFixture, status: "in_progress", date: pastDate(30 * 60 * 1000) });
      const results = await repo.findNeedingStatusUpdate();
      expect(results).toHaveLength(1);
    });

    it("excludes finished/cancelled/postponed fixtures", async () => {
      const repo = fixturesRepo(db);
      await repo.upsert({ ...sampleFixture, id: 1001, status: "finished", date: pastDate(60 * 60 * 1000) });
      await repo.upsert({ ...sampleFixture, id: 1002, status: "cancelled", date: pastDate(60 * 60 * 1000) });
      await repo.upsert({ ...sampleFixture, id: 1003, status: "postponed", date: pastDate(60 * 60 * 1000) });
      const results = await repo.findNeedingStatusUpdate();
      expect(results).toHaveLength(0);
    });

    it("excludes future scheduled fixtures", async () => {
      const repo = fixturesRepo(db);
      await repo.upsert({ ...sampleFixture, date: futureDate(2 * 60 * 60 * 1000) });
      const results = await repo.findNeedingStatusUpdate();
      expect(results).toHaveLength(0);
    });
  });

  describe("updateStatus", () => {
    it("updates status and updatedAt", async () => {
      const repo = fixturesRepo(db);
      await repo.upsert(sampleFixture);
      const before = await repo.findById(1001);

      await new Promise((r) => setTimeout(r, 10));
      await repo.updateStatus(1001, "in_progress");

      const after = await repo.findById(1001);
      expect(after?.status).toBe("in_progress");
      expect(after!.updatedAt.getTime()).toBeGreaterThanOrEqual(before!.updatedAt.getTime());
    });
  });
});
