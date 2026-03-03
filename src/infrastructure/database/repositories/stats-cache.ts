import { eq } from "drizzle-orm";
import type { PlayerSeasonStats, TeamSeasonStats } from "../../../domain/contracts/statistics.ts";
import type { Database } from "../client";
import { playerStatsCache, teamStatsCache } from "../schema";

export function statsCacheRepo(db: Database) {
  return {
    async getTeamStats(
      teamId: number,
      leagueId: number,
      season: number,
      maxAgeMs: number,
    ): Promise<TeamSeasonStats | null> {
      const key = `${teamId}-${leagueId}-${season}`;
      const row = await db.select().from(teamStatsCache).where(eq(teamStatsCache.id, key)).get();
      if (!row) return null;
      if (Date.now() - row.fetchedAt.getTime() > maxAgeMs) return null;
      return row.data;
    },

    async setTeamStats(
      teamId: number,
      leagueId: number,
      season: number,
      data: TeamSeasonStats,
    ): Promise<void> {
      const key = `${teamId}-${leagueId}-${season}`;
      await db
        .insert(teamStatsCache)
        .values({ id: key, teamId, leagueId, season, data, fetchedAt: new Date() })
        .onConflictDoUpdate({
          target: teamStatsCache.id,
          set: { data, fetchedAt: new Date() },
        });
    },

    async getPlayerStats(
      teamId: number,
      leagueId: number,
      season: number,
      maxAgeMs: number,
    ): Promise<PlayerSeasonStats[] | null> {
      const key = `${teamId}-${leagueId}-${season}`;
      const row = await db
        .select()
        .from(playerStatsCache)
        .where(eq(playerStatsCache.id, key))
        .get();
      if (!row) return null;
      if (Date.now() - row.fetchedAt.getTime() > maxAgeMs) return null;
      return row.data;
    },

    async setPlayerStats(
      teamId: number,
      leagueId: number,
      season: number,
      data: PlayerSeasonStats[],
    ): Promise<void> {
      const key = `${teamId}-${leagueId}-${season}`;
      await db
        .insert(playerStatsCache)
        .values({ id: key, teamId, leagueId, season, data, fetchedAt: new Date() })
        .onConflictDoUpdate({
          target: playerStatsCache.id,
          set: { data, fetchedAt: new Date() },
        });
    },
  };
}
