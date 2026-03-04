/**
 * Add Competitor — inserts a new weight-tuned competitor into the database.
 *
 * Usage:
 *   bun run competitor:add -- --id <id> --name <name> --model <openrouter-model-id>
 *
 * Example:
 *   bun run competitor:add -- --id wt-deepseek-r1 --name "Weight-Tuned DeepSeek R1" --model deepseek/deepseek-r1
 *
 * After adding, generate initial weights with:
 *   bun run iterate --competitor <id>
 */

import type { CompetitorsRepo } from "../database/repositories/competitors";

type AddCompetitorParams = {
  id: string;
  name: string;
  model: string;
};

type AddCompetitorResult = { success: true } | { success: false; error: string };

export function parseAddCompetitorArgs(args: string[]): AddCompetitorParams | null {
  const idIdx = args.indexOf("--id");
  const nameIdx = args.indexOf("--name");
  const modelIdx = args.indexOf("--model");

  const id = idIdx !== -1 ? args[idIdx + 1] : undefined;
  const name = nameIdx !== -1 ? args[nameIdx + 1] : undefined;
  const model = modelIdx !== -1 ? args[modelIdx + 1] : undefined;

  if (!id || !name || !model) {
    return null;
  }

  return { id, name, model };
}

export async function addCompetitor(
  repo: CompetitorsRepo,
  params: AddCompetitorParams,
): Promise<AddCompetitorResult> {
  const existing = await repo.findById(params.id);
  if (existing) {
    return { success: false, error: `Competitor "${params.id}" already exists` };
  }

  await repo.create({
    id: params.id,
    name: params.name,
    model: params.model,
    enginePath: "",
    status: "active",
    type: "weight-tuned",
    config: JSON.stringify({ model: params.model }),
  });

  return { success: true };
}

async function main() {
  const args = process.argv.slice(2);
  const params = parseAddCompetitorArgs(args);

  if (!params) {
    console.error(
      "Usage: bun run competitor:add -- --id <id> --name <name> --model <openrouter-model-id>",
    );
    console.error("");
    console.error("Example:");
    console.error(
      '  bun run competitor:add -- --id wt-deepseek-r1 --name "Weight-Tuned DeepSeek R1" --model deepseek/deepseek-r1',
    );
    process.exit(1);
  }

  const { createDb } = await import("../database/client");
  const { competitorsRepo } = await import("../database/repositories/competitors");
  const { env } = await import("../shared/env");

  const db = createDb(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
  const repo = competitorsRepo(db);

  const result = await addCompetitor(repo, params);

  if (result.success) {
    console.log(`Competitor "${params.id}" created successfully.`);
    console.log(`  Name:  ${params.name}`);
    console.log(`  Model: ${params.model}`);
    console.log("");
    console.log(`Next step: bun run iterate --competitor ${params.id}`);
  } else {
    console.error(`Failed: ${result.error}`);
    process.exit(1);
  }
}

// Only run main when executed directly (not imported by tests)
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === Bun.pathToFileURL(process.argv[1] ?? "").href;
if (isMainModule) {
  main().catch((err) => {
    console.error("Failed to add competitor:", err);
    process.exit(1);
  });
}
