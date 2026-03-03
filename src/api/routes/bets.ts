import { Hono } from "hono";
import type { ApiDeps } from "../index";

export function betsRoutes(deps: ApiDeps) {
  const app = new Hono();

  app.get("/bets", async (c) => {
    const statusFilter = c.req.query("status");
    const competitorFilter = c.req.query("competitorId");

    let allBets = await deps.betsRepo.findAll();

    if (statusFilter) {
      allBets = allBets.filter((b) => b.status === statusFilter);
    }
    if (competitorFilter) {
      allBets = allBets.filter((b) => b.competitorId === competitorFilter);
    }

    const [allCompetitors, allMarkets, allPredictions] = await Promise.all([
      deps.competitorsRepo.findAll(),
      deps.marketsRepo.findAll(),
      competitorFilter
        ? deps.predictionsRepo.findByCompetitor(competitorFilter)
        : deps.predictionsRepo.findAll(),
    ]);
    const competitorMap = new Map(allCompetitors.map((c) => [c.id, c.name]));
    const marketById = new Map(allMarkets.map((m) => [m.id, m]));
    const predictionMap = new Map(
      allPredictions.map((p) => [`${p.competitorId}:${p.marketId}:${p.side}`, p.confidence]),
    );

    return c.json(
      allBets.map((b) => ({
        id: b.id,
        competitorId: b.competitorId,
        competitorName: competitorMap.get(b.competitorId) ?? "Unknown",
        marketId: b.marketId,
        marketQuestion: marketById.get(b.marketId)?.question ?? "Unknown",
        polymarketUrl: marketById.get(b.marketId)?.polymarketUrl ?? null,
        fixtureId: b.fixtureId,
        side: b.side,
        amount: b.amount,
        price: b.price,
        shares: b.shares,
        status: b.status,
        placedAt: b.placedAt?.toISOString() ?? "",
        settledAt: b.settledAt?.toISOString() ?? null,
        profit: b.profit,
        confidence: predictionMap.get(`${b.competitorId}:${b.marketId}:${b.side}`) ?? null,
        errorMessage: b.errorMessage ?? null,
        errorCategory: b.errorCategory ?? null,
      })),
    );
  });

  return app;
}
