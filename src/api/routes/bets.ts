import { Hono } from "hono";
import type { ApiDeps } from "../index";
import { toBetSummary } from "../mappers";

export function betsRoutes(deps: ApiDeps) {
  const app = new Hono();

  app.get("/bets", async (c) => {
    const statusFilter = c.req.query("status");
    const competitorFilter = c.req.query("competitorId");
    const errorCategoryFilter = c.req.query("errorCategory");

    let allBets = await deps.betsRepo.findAll();

    if (statusFilter) {
      allBets = allBets.filter((b) => b.status === statusFilter);
    }
    if (competitorFilter) {
      allBets = allBets.filter((b) => b.competitorId === competitorFilter);
    }
    if (errorCategoryFilter) {
      allBets = allBets.filter((b) => b.errorCategory === errorCategoryFilter);
    }

    const [allCompetitors, allMarkets, allPredictions] = await Promise.all([
      deps.competitorsRepo.findAll(),
      deps.marketsRepo.findAll(),
      competitorFilter
        ? deps.predictionsRepo.findByCompetitor(competitorFilter)
        : deps.predictionsRepo.findAll(),
    ]);

    const lookups = {
      competitorMap: new Map(allCompetitors.map((c) => [c.id, c.name])),
      marketById: new Map(allMarkets.map((m) => [m.id, m])),
      predictionMap: new Map(
        allPredictions.map((p) => [`${p.competitorId}:${p.marketId}:${p.side}`, p.confidence]),
      ),
    };

    return c.json(allBets.map((b) => toBetSummary(b, lookups)));
  });

  return app;
}
