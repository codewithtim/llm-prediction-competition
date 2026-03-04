import { beforeEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { PlayerSeasonStats, TeamSeasonStats } from "../../../../src/domain/contracts/statistics";
import type { Database } from "../../../../src/database/client";
import { statsCacheRepo } from "../../../../src/database/repositories/stats-cache";
import * as schema from "../../../../src/database/schema";

let db: Database;

const sampleTeamStats: TeamSeasonStats = {
  form: "WWDLW",
  fixtures: { played: { home: 10, away: 10, total: 20 } },
  cleanSheets: { home: 6, away: 3, total: 9 },
  failedToScore: { home: 1, away: 3, total: 4 },
  biggestStreak: { wins: 5, draws: 2, loses: 1 },
  penaltyRecord: { scored: 4, missed: 1, total: 5 },
  preferredFormations: [{ formation: "4-3-3", played: 12 }],
  goalsForByMinute: {
    "0-15": { total: 5, percentage: "13%" },
    "16-30": { total: 3, percentage: "8%" },
    "31-45": { total: 4, percentage: "11%" },
    "46-60": { total: 6, percentage: "16%" },
    "61-75": { total: 8, percentage: "22%" },
    "76-90": { total: 5, percentage: "13%" },
    "91-105": { total: 2, percentage: "5%" },
    "106-120": { total: null, percentage: null },
  },
  goalsAgainstByMinute: {
    "0-15": { total: 3, percentage: "15%" },
    "16-30": { total: 4, percentage: "20%" },
    "31-45": { total: 3, percentage: "15%" },
    "46-60": { total: 3, percentage: "15%" },
    "61-75": { total: 4, percentage: "20%" },
    "76-90": { total: 2, percentage: "10%" },
    "91-105": { total: 1, percentage: "5%" },
    "106-120": { total: null, percentage: null },
  },
  goalsForUnderOver: {
    "0.5": { over: 18, under: 2 },
    "1.5": { over: 15, under: 5 },
    "2.5": { over: 10, under: 10 },
    "3.5": { over: 5, under: 15 },
    "4.5": { over: 2, under: 18 },
  },
  goalsAgainstUnderOver: {
    "0.5": { over: 14, under: 6 },
    "1.5": { over: 8, under: 12 },
    "2.5": { over: 3, under: 17 },
    "3.5": { over: 1, under: 19 },
    "4.5": { over: 0, under: 20 },
  },
};

const samplePlayerStats: PlayerSeasonStats[] = [
  {
    playerId: 100,
    name: "Mohamed Salah",
    position: "Attacker",
    rating: 8.1,
    appearances: 18,
    minutes: 1500,
    goals: 15,
    assists: 8,
    shotsTotal: 60,
    shotsOnTarget: 35,
    passesKey: 25,
    passAccuracy: 82,
    dribblesSuccess: 30,
    dribblesAttempts: 50,
    yellowCards: 2,
    redCards: 0,
    injured: false,
  },
];

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  db = drizzle(client, { schema }) as Database;
  await migrate(db, { migrationsFolder: "./drizzle" });
});

describe("statsCacheRepo", () => {
  describe("team stats", () => {
    it("returns null when no cache entry", async () => {
      const repo = statsCacheRepo(db);
      const result = await repo.getTeamStats(40, 39, 2024, 86400000);
      expect(result).toBeNull();
    });

    it("returns null when cache is stale", async () => {
      const repo = statsCacheRepo(db);
      await db.insert(schema.teamStatsCache).values({
        id: "40-39-2024",
        teamId: 40,
        leagueId: 39,
        season: 2024,
        data: sampleTeamStats,
        fetchedAt: new Date(Date.now() - 100000000),
      });

      const result = await repo.getTeamStats(40, 39, 2024, 86400000);
      expect(result).toBeNull();
    });

    it("returns data when cache is fresh", async () => {
      const repo = statsCacheRepo(db);
      await repo.setTeamStats(40, 39, 2024, sampleTeamStats);

      const result = await repo.getTeamStats(40, 39, 2024, 86400000);
      expect(result).not.toBeNull();
      expect(result?.cleanSheets.total).toBe(9);
      expect(result?.form).toBe("WWDLW");
    });

    it("upserts correctly on duplicate key", async () => {
      const repo = statsCacheRepo(db);
      await repo.setTeamStats(40, 39, 2024, sampleTeamStats);

      const updated = { ...sampleTeamStats, form: "LLLLL" };
      await repo.setTeamStats(40, 39, 2024, updated);

      const result = await repo.getTeamStats(40, 39, 2024, 86400000);
      expect(result?.form).toBe("LLLLL");
    });
  });

  describe("player stats", () => {
    it("returns null when no cache entry", async () => {
      const repo = statsCacheRepo(db);
      const result = await repo.getPlayerStats(40, 39, 2024, 86400000);
      expect(result).toBeNull();
    });

    it("returns null when cache is stale", async () => {
      const repo = statsCacheRepo(db);
      await db.insert(schema.playerStatsCache).values({
        id: "40-39-2024",
        teamId: 40,
        leagueId: 39,
        season: 2024,
        data: samplePlayerStats,
        fetchedAt: new Date(Date.now() - 100000000),
      });

      const result = await repo.getPlayerStats(40, 39, 2024, 86400000);
      expect(result).toBeNull();
    });

    it("returns data when cache is fresh", async () => {
      const repo = statsCacheRepo(db);
      await repo.setPlayerStats(40, 39, 2024, samplePlayerStats);

      const result = await repo.getPlayerStats(40, 39, 2024, 86400000);
      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result?.[0]?.name).toBe("Mohamed Salah");
    });

    it("upserts correctly on duplicate key", async () => {
      const repo = statsCacheRepo(db);
      await repo.setPlayerStats(40, 39, 2024, samplePlayerStats);

      const updated = [{ ...samplePlayerStats[0]!, name: "Updated Player" }];
      await repo.setPlayerStats(40, 39, 2024, updated);

      const result = await repo.getPlayerStats(40, 39, 2024, 86400000);
      expect(result?.[0]?.name).toBe("Updated Player");
    });
  });
});
