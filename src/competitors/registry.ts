import type { PredictionEngine, RegisteredEngine } from "../engine/types";

export class CompetitorRegistry {
  private engines: Map<string, RegisteredEngine> = new Map();

  register(competitorId: string, name: string, engine: PredictionEngine): void {
    this.engines.set(competitorId, { competitorId, name, engine });
  }

  getAll(): RegisteredEngine[] {
    return [...this.engines.values()];
  }

  get(competitorId: string): RegisteredEngine | undefined {
    return this.engines.get(competitorId);
  }

  unregister(competitorId: string): boolean {
    return this.engines.delete(competitorId);
  }
}

export function createRegistry(): CompetitorRegistry {
  return new CompetitorRegistry();
}
