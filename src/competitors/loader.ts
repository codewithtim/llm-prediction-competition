import type { RuntimeConfig } from "../domain/types/competitor";
import type { RegisteredEngine } from "../engine/types";
import type { CompetitorsRepo } from "../infrastructure/database/repositories/competitors";
import type { OpenRouterClient } from "../infrastructure/openrouter/client";
import { logger } from "../shared/logger";
import { loadCodegenEngine } from "./llm-codegen/engine";
import { createLlmRuntimeEngine } from "./llm-runtime/engine";

export type LoaderDeps = {
  competitorsRepo: CompetitorsRepo;
  openrouterClient: OpenRouterClient | null;
};

export async function loadCompetitors(deps: LoaderDeps): Promise<RegisteredEngine[]> {
  const { competitorsRepo, openrouterClient } = deps;
  const rows = await competitorsRepo.findByStatus("active");
  const engines: RegisteredEngine[] = [];

  for (const row of rows) {
    try {
      const engine = await loadSingleCompetitor(row, openrouterClient);
      if (engine) {
        engines.push({ competitorId: row.id, name: row.name, engine });
        logger.info("Loaded competitor", { id: row.id, type: row.type });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Failed to load competitor", { id: row.id, error: message });
      await competitorsRepo.setStatus(row.id, "error");
    }
  }

  logger.info("Competitor loading complete", { loaded: engines.length, total: rows.length });
  return engines;
}

async function loadSingleCompetitor(
  row: { id: string; type: string; config: string | null; enginePath: string | null },
  openrouterClient: OpenRouterClient | null,
) {
  switch (row.type) {
    case "baseline": {
      const mod = await import("./baseline/engine.ts");
      return mod.baselineEngine;
    }

    case "runtime": {
      if (!openrouterClient) {
        logger.info("Skipping runtime competitor (no OpenRouter client)", { id: row.id });
        return null;
      }
      const config = parseConfig<RuntimeConfig>(row.config);
      if (!config?.model) {
        throw new Error("Runtime competitor missing model in config");
      }
      return createLlmRuntimeEngine({ client: openrouterClient, model: config.model });
    }

    case "codegen": {
      if (!row.enginePath) {
        throw new Error("Codegen competitor missing enginePath");
      }
      return loadCodegenEngine(row.enginePath);
    }

    case "external": {
      logger.info("Skipping external competitor (not yet implemented)", { id: row.id });
      return null;
    }

    default:
      throw new Error(`Unknown competitor type: ${row.type}`);
  }
}

function parseConfig<T>(raw: string | null): T | null {
  if (!raw) return null;
  return JSON.parse(raw) as T;
}
