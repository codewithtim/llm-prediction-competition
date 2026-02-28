/**
 * Iterate — triggers the iteration loop for codegen or weight-tuned competitors.
 *
 * Gathers performance data, builds feedback prompts, calls the LLM to
 * generate improved engine code/weights, validates it, and saves new versions.
 *
 * Usage:
 *   bun run iterate                              # iterate all codegen competitors
 *   bun run iterate --type weight-tuned          # iterate all weight-tuned competitors
 *   bun run iterate --competitor <id>            # iterate a specific competitor
 *   bun run iterate --type weight-tuned --competitor <id>
 */

import { createCodeGenerator } from "../competitors/llm-codegen/generator.ts";
import { createIterationService } from "../competitors/llm-codegen/iteration.ts";
import { createRegistry } from "../competitors/registry.ts";
import { createWeightGenerator } from "../competitors/weight-tuned/generator.ts";
import { createWeightIterationService } from "../competitors/weight-tuned/iteration.ts";
import { DEFAULT_STAKE_CONFIG } from "../competitors/weight-tuned/types.ts";
import { createDb } from "../infrastructure/database/client.ts";
import { betsRepo } from "../infrastructure/database/repositories/bets.ts";
import { competitorVersionsRepo } from "../infrastructure/database/repositories/competitor-versions.ts";
import { competitorsRepo } from "../infrastructure/database/repositories/competitors.ts";
import { marketsRepo } from "../infrastructure/database/repositories/markets.ts";
import { predictionsRepo } from "../infrastructure/database/repositories/predictions.ts";
import { createOpenRouterClient } from "../infrastructure/openrouter/client.ts";
import { env } from "../shared/env.ts";

function parseArgs(): { competitorId?: string; type: "codegen" | "weight-tuned" } {
  const args = process.argv.slice(2);

  let competitorId: string | undefined;
  const compIdx = args.indexOf("--competitor");
  if (compIdx !== -1 && args[compIdx + 1]) {
    competitorId = args[compIdx + 1];
  }

  let type: "codegen" | "weight-tuned" = "codegen";
  const typeIdx = args.indexOf("--type");
  if (typeIdx !== -1 && args[typeIdx + 1] === "weight-tuned") {
    type = "weight-tuned";
  }

  return { competitorId, type };
}

async function main() {
  const { competitorId, type } = parseArgs();

  const db = createDb(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
  const openrouter = createOpenRouterClient(env.OPENROUTER_API_KEY);
  const registry = createRegistry();

  const repos = {
    competitorsRepo: competitorsRepo(db),
    versionsRepo: competitorVersionsRepo(db),
    betsRepo: betsRepo(db),
    predictionsRepo: predictionsRepo(db),
    marketsRepo: marketsRepo(db),
  };

  if (type === "weight-tuned") {
    const generator = createWeightGenerator({ client: openrouter });
    const service = createWeightIterationService({
      generator,
      ...repos,
      registry,
      stakeConfig: DEFAULT_STAKE_CONFIG,
    });

    if (competitorId) {
      console.log(`Iterating weight-tuned competitor: ${competitorId}\n`);
      const result = await service.iterateCompetitor(competitorId);
      if (result.success) {
        console.log(`Success: version ${result.version}`);
      } else {
        console.error(`Failed: ${result.error}`);
        process.exit(1);
      }
    } else {
      console.log("Iterating all weight-tuned competitors...\n");
      const results = await service.iterateAll();
      let failures = 0;
      for (const result of results) {
        if (result.success) {
          console.log(`  ${result.competitorId}: v${result.version}`);
        } else {
          console.error(`  ${result.competitorId}: FAILED — ${result.error}`);
          failures++;
        }
      }
      console.log(`\nDone: ${results.length - failures}/${results.length} succeeded`);
      if (failures > 0) process.exit(1);
    }
  } else {
    const generator = createCodeGenerator({ client: openrouter });
    const service = createIterationService({
      generator,
      ...repos,
      registry,
    });

    if (competitorId) {
      console.log(`Iterating competitor: ${competitorId}\n`);
      const result = await service.iterateCompetitor(competitorId);
      if (result.success) {
        console.log(`Success: version ${result.version}`);
        console.log(`Engine path: ${result.enginePath}`);
      } else {
        console.error(`Failed: ${result.error}`);
        process.exit(1);
      }
    } else {
      console.log("Iterating all codegen competitors...\n");
      const results = await service.iterateAll();
      let failures = 0;
      for (const result of results) {
        if (result.success) {
          console.log(`  ${result.competitorId}: v${result.version} → ${result.enginePath}`);
        } else {
          console.error(`  ${result.competitorId}: FAILED — ${result.error}`);
          failures++;
        }
      }
      console.log(`\nDone: ${results.length - failures}/${results.length} succeeded`);
      if (failures > 0) process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error("Iteration failed:", err);
  process.exit(1);
});
