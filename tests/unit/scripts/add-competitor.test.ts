import { beforeEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Database } from "../../../src/database/client";
import { competitorsRepo } from "../../../src/database/repositories/competitors";
import * as schema from "../../../src/database/schema";
import { addCompetitor, parseAddCompetitorArgs } from "../../../src/scripts/add-competitor";

let db: Database;

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  db = drizzle(client, { schema }) as Database;
  await migrate(db, { migrationsFolder: "./drizzle" });
});

describe("parseAddCompetitorArgs", () => {
  it("parses all three required args", () => {
    const result = parseAddCompetitorArgs([
      "--id",
      "wt-test",
      "--name",
      "Test Bot",
      "--model",
      "openai/gpt-4o",
    ]);
    expect(result).toEqual({
      id: "wt-test",
      name: "Test Bot",
      model: "openai/gpt-4o",
    });
  });

  it("returns null when --id is missing", () => {
    const result = parseAddCompetitorArgs(["--name", "Test Bot", "--model", "openai/gpt-4o"]);
    expect(result).toBeNull();
  });

  it("returns null when --name is missing", () => {
    const result = parseAddCompetitorArgs(["--id", "wt-test", "--model", "openai/gpt-4o"]);
    expect(result).toBeNull();
  });

  it("returns null when --model is missing", () => {
    const result = parseAddCompetitorArgs(["--id", "wt-test", "--name", "Test Bot"]);
    expect(result).toBeNull();
  });

  it("returns null for empty args", () => {
    const result = parseAddCompetitorArgs([]);
    expect(result).toBeNull();
  });
});

describe("addCompetitor", () => {
  it("creates a competitor with correct defaults", async () => {
    const repo = competitorsRepo(db);
    const result = await addCompetitor(repo, {
      id: "wt-new-model",
      name: "New Model Bot",
      model: "openai/gpt-4o",
    });

    expect(result.success).toBe(true);

    const found = await repo.findById("wt-new-model");
    expect(found).toBeDefined();
    expect(found?.name).toBe("New Model Bot");
    expect(found?.model).toBe("openai/gpt-4o");
    expect(found?.type).toBe("weight-tuned");
    expect(found?.status).toBe("active");
    expect(found?.config).toBe('{"model":"openai/gpt-4o"}');
  });

  it("returns error when competitor already exists", async () => {
    const repo = competitorsRepo(db);

    // The migration seeds competitors, including wt-gpt-52
    const result = await addCompetitor(repo, {
      id: "wt-gpt-52",
      name: "Duplicate",
      model: "openai/gpt-5.2",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("already exists");
    }
  });
});
