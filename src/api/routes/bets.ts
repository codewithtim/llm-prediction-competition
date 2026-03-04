import { Hono } from "hono";
import type { BetDetailResponse } from "../../shared/api-types";
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

  app.get("/bets/:id", async (c) => {
    const id = c.req.param("id");
    const bet = await deps.betsRepo.findById(id);
    if (!bet) return c.json({ error: "Bet not found" }, 404);

    const [competitor, market, fixture, predictions] = await Promise.all([
      deps.competitorsRepo.findById(bet.competitorId),
      deps.marketsRepo.findById(bet.marketId),
      deps.fixturesRepo.findById(bet.fixtureId),
      deps.predictionsRepo.findByMarket(bet.marketId),
    ]);

    const prediction = predictions.find(
      (p) => p.competitorId === bet.competitorId && p.side === bet.side,
    );

    return c.json({
      id: bet.id,
      competitorId: bet.competitorId,
      competitorName: competitor?.name ?? "Unknown",
      marketId: bet.marketId,
      marketQuestion: market?.question ?? "Unknown",
      polymarketUrl: market?.polymarketUrl ?? null,
      fixtureId: bet.fixtureId,
      side: bet.side,
      amount: bet.amount,
      price: bet.price,
      shares: bet.shares,
      status: bet.status,
      placedAt: bet.placedAt?.toISOString() ?? "",
      settledAt: bet.settledAt?.toISOString() ?? null,
      profit: bet.profit,
      confidence: prediction?.confidence ?? null,
      errorMessage: bet.errorMessage ?? null,
      errorCategory: bet.errorCategory ?? null,
      attempts: bet.attempts ?? 0,
      fixtureSummary: fixture ? `${fixture.homeTeamName} vs ${fixture.awayTeamName}` : null,
      fixtureDate: fixture?.date ?? null,
      fixtureStatus: fixture?.status ?? null,
      marketOutcomes: market?.outcomes ?? null,
      marketOutcomePrices: market?.outcomePrices ?? null,
      marketActive: market?.active ?? null,
      marketClosed: market?.closed ?? null,
      reasoning: prediction?.reasoning ?? null,
      orderId: bet.orderId ?? null,
      lastAttemptAt: bet.lastAttemptAt?.toISOString() ?? null,
    } satisfies BetDetailResponse);
  });

  return app;
}
