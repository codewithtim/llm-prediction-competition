import { beforeEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Database } from "../../../../../src/infrastructure/database/client";
import { competitorsRepo } from "../../../../../src/infrastructure/database/repositories/competitors";
import * as schema from "../../../../../src/infrastructure/database/schema";

let db: Database;

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  db = drizzle(client, { schema }) as Database;
  await migrate(db, { migrationsFolder: "./drizzle" });
});

const sampleCompetitor: typeof schema.competitors.$inferInsert = {
  id: "claude-1",
  name: "Claude",
  model: "anthropic/claude-sonnet-4",
  enginePath: "src/competitors/claude/engine.ts",
  active: true,
};

describe("competitorsRepo", () => {
  it("creates and retrieves a competitor", async () => {
    const repo = competitorsRepo(db);
    await repo.create(sampleCompetitor);
    const found = await repo.findById("claude-1");
    expect(found?.name).toBe("Claude");
    expect(found?.model).toBe("anthropic/claude-sonnet-4");
  });

  it("finds active competitors", async () => {
    const repo = competitorsRepo(db);
    await repo.create(sampleCompetitor);
    await repo.create({ ...sampleCompetitor, id: "gpt-1", name: "GPT-4", active: false });
    const active = await repo.findActive();
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe("claude-1");
  });

  it("sets active status", async () => {
    const repo = competitorsRepo(db);
    await repo.create(sampleCompetitor);
    await repo.setActive("claude-1", false);
    const found = await repo.findById("claude-1");
    expect(found?.active).toBe(false);
  });

  it("returns undefined for missing competitor", async () => {
    const repo = competitorsRepo(db);
    const found = await repo.findById("nonexistent");
    expect(found).toBeUndefined();
  });
});
