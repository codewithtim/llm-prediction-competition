import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { loadCompetitors } from "../../../src/competitors/loader";
import type { Database } from "../../../src/infrastructure/database/client";
import { competitorsRepo } from "../../../src/infrastructure/database/repositories/competitors";
import { walletsRepo } from "../../../src/infrastructure/database/repositories/wallets";
import * as schema from "../../../src/infrastructure/database/schema";
import type { OpenRouterClient } from "../../../src/infrastructure/openrouter/client";

let db: Database;

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  db = drizzle(client, { schema }) as Database;
  await migrate(db, { migrationsFolder: "./drizzle" });
});

const mockOpenRouterClient: OpenRouterClient = {
  chat: mock(() => Promise.resolve("{}")),
};

describe("loadCompetitors", () => {
  it("loads baseline competitor without OpenRouter", async () => {
    const repo = competitorsRepo(db);

    // Disable runtime and weight-tuned competitors so only baseline loads
    await repo.setStatus("anthropic-claude-sonnet-4", "disabled");
    await repo.setStatus("openai-gpt-4o", "disabled");
    await repo.setStatus("google-gemini-2.0-flash-001", "disabled");
    await repo.setStatus("wt-claude-sonnet", "disabled");
    await repo.setStatus("wt-gpt-4o", "disabled");
    await repo.setStatus("wt-gemini-flash", "disabled");

    const engines = await loadCompetitors({
      competitorsRepo: repo,
      openrouterClient: null,
      walletsRepo: walletsRepo(db),
      encryptionKey: "",
    });

    expect(engines).toHaveLength(1);
    expect(engines[0]?.competitorId).toBe("baseline");
    expect(typeof engines[0]?.engine).toBe("function");
  });

  it("skips runtime competitors when no OpenRouter client", async () => {
    const repo = competitorsRepo(db);

    const engines = await loadCompetitors({
      competitorsRepo: repo,
      openrouterClient: null,
      walletsRepo: walletsRepo(db),
      encryptionKey: "",
    });

    // Baseline + 3 weight-tuned load; runtime competitors skipped
    expect(engines).toHaveLength(4);
    expect(engines[0]?.competitorId).toBe("baseline");
  });

  it("loads runtime competitors when OpenRouter client is provided", async () => {
    const repo = competitorsRepo(db);

    const engines = await loadCompetitors({
      competitorsRepo: repo,
      openrouterClient: mockOpenRouterClient,
      walletsRepo: walletsRepo(db),
      encryptionKey: "",
    });

    expect(engines).toHaveLength(7);
    const ids = engines.map((e) => e.competitorId).sort();
    expect(ids).toEqual([
      "anthropic-claude-sonnet-4",
      "baseline",
      "google-gemini-2.0-flash-001",
      "openai-gpt-4o",
      "wt-claude-sonnet",
      "wt-gemini-flash",
      "wt-gpt-4o",
    ]);
  });

  it("does not load disabled competitors", async () => {
    const repo = competitorsRepo(db);
    await repo.setStatus("anthropic-claude-sonnet-4", "disabled");

    const engines = await loadCompetitors({
      competitorsRepo: repo,
      openrouterClient: mockOpenRouterClient,
      walletsRepo: walletsRepo(db),
      encryptionKey: "",
    });

    expect(engines).toHaveLength(6);
    const ids = engines.map((e) => e.competitorId);
    expect(ids).not.toContain("anthropic-claude-sonnet-4");
  });

  it("sets competitor status to error on load failure", async () => {
    const repo = competitorsRepo(db);

    // Insert a codegen competitor with a bad engine path
    await repo.create({
      id: "bad-codegen",
      name: "Bad Codegen",
      model: "test",
      type: "codegen",
      status: "active",
      enginePath: "nonexistent/engine.ts",
    });

    await loadCompetitors({
      competitorsRepo: repo,
      openrouterClient: null,
      walletsRepo: walletsRepo(db),
      encryptionKey: "",
    });

    const updated = await repo.findById("bad-codegen");
    expect(updated?.status).toBe("error");
  });
});
