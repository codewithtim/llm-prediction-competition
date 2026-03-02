import { Hono } from "hono";
import type { ApiDeps } from "../index";

export function predictionsRoutes(deps: ApiDeps) {
  const app = new Hono();

  app.get("/predictions", async (c) => {
    const competitorFilter = c.req.query("competitorId");

    let allPredictions = await deps.predictionsRepo.findAll();

    if (competitorFilter) {
      allPredictions = allPredictions.filter((p) => p.competitorId === competitorFilter);
    }

    const allCompetitors = await deps.competitorsRepo.findAll();
    const competitorMap = new Map(allCompetitors.map((c) => [c.id, c.name]));
    const allMarkets = await deps.marketsRepo.findAll();
    const marketMap = new Map(allMarkets.map((m) => [m.id, m.question]));

    return c.json(
      allPredictions.map((p) => ({
        id: p.id,
        competitorId: p.competitorId,
        competitorName: competitorMap.get(p.competitorId) ?? "Unknown",
        marketId: p.marketId,
        marketQuestion: marketMap.get(p.marketId) ?? "Unknown",
        fixtureId: p.fixtureId,
        side: p.side,
        confidence: p.confidence,
        stake: p.stake,
        reasoning: p.reasoning,
        createdAt: p.createdAt?.toISOString() ?? "",
      })),
    );
  });

  return app;
}
