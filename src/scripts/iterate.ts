/**
 * Iterate — triggers the iteration loop for weight-tuned competitors.
 *
 * Gathers performance data, builds feedback prompts, calls the LLM to
 * generate improved weights, validates them, and saves new versions.
 *
 * Usage:
 *   bun run iterate                              # iterate all weight-tuned competitors
 *   bun run iterate --competitor <id>            # iterate a specific competitor
 */

import { defaultAdapterFactories } from "../apis/notifications/adapter-registry.ts";
import { createOpenRouterClient } from "../apis/openrouter/client.ts";
import { createRegistry } from "../competitors/registry.ts";
import { createWeightGenerator } from "../competitors/weight-tuned/generator.ts";
import type { WeightIterationResult } from "../competitors/weight-tuned/iteration.ts";
import { createWeightIterationService } from "../competitors/weight-tuned/iteration.ts";
import { DEFAULT_STAKE_CONFIG } from "../competitors/weight-tuned/types.ts";
import { createDb } from "../database/client.ts";
import { betsRepo } from "../database/repositories/bets.ts";
import { competitorVersionsRepo } from "../database/repositories/competitor-versions.ts";
import { competitorsRepo } from "../database/repositories/competitors.ts";
import { marketsRepo } from "../database/repositories/markets.ts";
import { notificationChannelsRepo } from "../database/repositories/notification-channels.ts";
import { predictionsRepo } from "../database/repositories/predictions.ts";
import { createNotificationService } from "../domain/services/notification.ts";
import { env } from "../shared/env.ts";

function parseArgs(): { competitorId?: string } {
  const args = process.argv.slice(2);

  let competitorId: string | undefined;
  const compIdx = args.indexOf("--competitor");
  if (compIdx !== -1 && args[compIdx + 1]) {
    competitorId = args[compIdx + 1];
  }

  return { competitorId };
}

async function main() {
  if (!env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY is not set. Cannot generate weights.");
    process.exit(1);
  }

  const { competitorId } = parseArgs();

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

  const generator = createWeightGenerator({ client: openrouter });
  const service = createWeightIterationService({
    generator,
    ...repos,
    registry,
    stakeConfig: DEFAULT_STAKE_CONFIG,
  });

  const notificationService = createNotificationService({
    channelsRepo: notificationChannelsRepo(db),
    adapterFactories: defaultAdapterFactories,
  });

  async function sendIterationNotification(results: WeightIterationResult[]) {
    const competitors = await repos.competitorsRepo.findAll();
    const competitorMap = new Map(competitors.map((c) => [c.id, c]));

    const successes = results
      .filter((r): r is WeightIterationResult & { success: true } => r.success)
      .map((r) => ({
        competitorId: r.competitorId,
        competitorName: competitorMap.get(r.competitorId)?.name ?? r.competitorId,
        version: r.version,
        model: competitorMap.get(r.competitorId)?.model ?? "unknown",
      }));

    const failures = results
      .filter((r): r is WeightIterationResult & { success: false } => !r.success)
      .map((r) => ({
        competitorId: r.competitorId,
        competitorName: competitorMap.get(r.competitorId)?.name ?? r.competitorId,
        error: r.error,
      }));

    if (successes.length > 0 || failures.length > 0) {
      await notificationService.notify({
        type: "iteration_complete",
        successes,
        failures,
      });
    }
  }

  if (competitorId) {
    console.log(`Iterating weight-tuned competitor: ${competitorId}\n`);
    const result = await service.iterateCompetitor(competitorId);
    await sendIterationNotification([result]);
    if (result.success) {
      console.log(`Success: version ${result.version}`);
    } else {
      console.error(`Failed: ${result.error}`);
      process.exit(1);
    }
  } else {
    console.log("Iterating all weight-tuned competitors...\n");
    const results = await service.iterateAll();
    await sendIterationNotification(results);
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
}

main().catch((err) => {
  console.error("Iteration failed:", err);
  process.exit(1);
});
