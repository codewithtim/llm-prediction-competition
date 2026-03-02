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
  status: "active",
  type: "codegen",
};

describe("competitorsRepo", () => {
  it("creates and retrieves a competitor", async () => {
    const repo = competitorsRepo(db);
    await repo.create(sampleCompetitor);
    const found = await repo.findById("claude-1");
    expect(found?.name).toBe("Claude");
    expect(found?.model).toBe("anthropic/claude-sonnet-4");
  });

  it("finds competitors by status", async () => {
    const repo = competitorsRepo(db);
    await repo.create(sampleCompetitor);
    await repo.create({ ...sampleCompetitor, id: "gpt-1", name: "GPT-4", status: "disabled" });
    const active = await repo.findByStatus("active");
    const activeIds = active.map((c) => c.id);
    expect(activeIds).toContain("claude-1");
    expect(activeIds).not.toContain("gpt-1");

    const disabled = await repo.findByStatus("disabled");
    expect(disabled).toHaveLength(1);
    expect(disabled[0]?.id).toBe("gpt-1");
  });

  it("sets status", async () => {
    const repo = competitorsRepo(db);
    await repo.create(sampleCompetitor);
    await repo.setStatus("claude-1", "error");
    const found = await repo.findById("claude-1");
    expect(found?.status).toBe("error");
  });

  it("returns undefined for missing competitor", async () => {
    const repo = competitorsRepo(db);
    const found = await repo.findById("nonexistent");
    expect(found).toBeUndefined();
  });

  it("finds all competitors", async () => {
    const repo = competitorsRepo(db);
    const before = await repo.findAll();
    await repo.create(sampleCompetitor);
    await repo.create({ ...sampleCompetitor, id: "gpt-1", name: "GPT-4", status: "disabled" });
    const after = await repo.findAll();
    expect(after.length).toBe(before.length + 2);
  });
});
