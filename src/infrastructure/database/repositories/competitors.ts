import { eq } from "drizzle-orm";
import type { CompetitorStatus } from "../../../domain/types/competitor";
import type { Database } from "../client";
import { competitors } from "../schema";

export function competitorsRepo(db: Database) {
  return {
    async create(competitor: typeof competitors.$inferInsert) {
      return db.insert(competitors).values(competitor);
    },

    async findById(id: string) {
      return db.select().from(competitors).where(eq(competitors.id, id)).get();
    },

    async findByStatus(status: CompetitorStatus) {
      return db.select().from(competitors).where(eq(competitors.status, status)).all();
    },

    async setStatus(id: string, status: CompetitorStatus) {
      return db.update(competitors).set({ status }).where(eq(competitors.id, id));
    },

    async updateEnginePath(id: string, enginePath: string) {
      return db.update(competitors).set({ enginePath }).where(eq(competitors.id, id));
    },
  };
}

export type CompetitorsRepo = ReturnType<typeof competitorsRepo>;
