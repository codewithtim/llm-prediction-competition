import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { competitorVersions } from "../schema";

export function competitorVersionsRepo(db: Database) {
  return {
    async create(version: typeof competitorVersions.$inferInsert) {
      return db.insert(competitorVersions).values(version).run();
    },

    async findByCompetitor(competitorId: string) {
      return db
        .select()
        .from(competitorVersions)
        .where(eq(competitorVersions.competitorId, competitorId))
        .orderBy(desc(competitorVersions.version))
        .all();
    },

    async findLatest(competitorId: string) {
      return db
        .select()
        .from(competitorVersions)
        .where(eq(competitorVersions.competitorId, competitorId))
        .orderBy(desc(competitorVersions.version))
        .limit(1)
        .get();
    },

    async findByVersion(competitorId: string, version: number) {
      return db
        .select()
        .from(competitorVersions)
        .where(
          and(
            eq(competitorVersions.competitorId, competitorId),
            eq(competitorVersions.version, version),
          ),
        )
        .get();
    },
  };
}
