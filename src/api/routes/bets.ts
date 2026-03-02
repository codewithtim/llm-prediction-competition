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

    const allCompetitors = await deps.competitorsRepo.findAll();
    const competitorMap = new Map(allCompetitors.map((c) => [c.id, c.name]));
    const allMarkets = await deps.marketsRepo.findAll();
    const marketMap = new Map(allMarkets.map((m) => [m.id, m.question]));

    return c.json(
      allBets.map((b) => ({
        id: b.id,
        competitorId: b.competitorId,
        competitorName: competitorMap.get(b.competitorId) ?? "Unknown",
        marketId: b.marketId,
        marketQuestion: marketMap.get(b.marketId) ?? "Unknown",
        fixtureId: b.fixtureId,
        side: b.side,
        amount: b.amount,
        price: b.price,
        shares: b.shares,
        status: b.status,
        placedAt: b.placedAt?.toISOString() ?? "",
        settledAt: b.settledAt?.toISOString() ?? null,
        profit: b.profit,
      })),
    );
  });

  return app;
}
