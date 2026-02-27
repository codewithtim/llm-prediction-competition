import type { Statistics } from "../domain/contracts/statistics";
import type { EngineError, EngineResult, RegisteredEngine } from "./types";
import { validatePredictions } from "./validator";

export async function runEngine(
  registered: RegisteredEngine,
  statistics: Statistics,
): Promise<EngineResult | EngineError> {
  let raw: unknown;
  try {
    raw = await registered.engine(statistics);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { competitorId: registered.competitorId, error: message };
  }

  const { valid, errors } = validatePredictions(raw);

  if (errors.length > 0) {
    return {
      competitorId: registered.competitorId,
      error: `Validation failed: ${errors.join("; ")}`,
    };
  }

  return { competitorId: registered.competitorId, predictions: valid };
}

export async function runAllEngines(
  engines: RegisteredEngine[],
  statistics: Statistics,
): Promise<Array<EngineResult | EngineError>> {
  const results: Array<EngineResult | EngineError> = [];
  for (const engine of engines) {
    results.push(await runEngine(engine, statistics));
  }
  return results;
}
