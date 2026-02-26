import { eq } from "drizzle-orm";
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

    async findActive() {
      return db.select().from(competitors).where(eq(competitors.active, true)).all();
    },

    async setActive(id: string, active: boolean) {
      return db.update(competitors).set({ active }).where(eq(competitors.id, id));
    },
  };
}
