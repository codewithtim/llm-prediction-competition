import { Hono } from "hono";
import type { BetAuditEntry, BetDetailResponse } from "../../shared/api-types";
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

    const lookups = {
      competitorMap: new Map(competitor ? [[competitor.id, competitor.name]] : []),
      marketById: new Map(market ? [[market.id, market]] : []),
      predictionMap: new Map(
        prediction
          ? [
              [
                `${prediction.competitorId}:${prediction.marketId}:${prediction.side}`,
                prediction.confidence,
              ],
            ]
          : [],
      ),
    };

    return c.json({
      ...toBetSummary(bet, lookups),
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

  app.get("/bets/:id/audit", async (c) => {
    const entries = await deps.auditLogRepo.findByBetId(c.req.param("id"));
    return c.json({
      entries: entries.map(
        (e) =>
          ({
            id: e.id,
            betId: e.betId,
            event: e.event,
            statusBefore: e.statusBefore,
            statusAfter: e.statusAfter,
            orderId: e.orderId,
            error: e.error,
            errorCategory: e.errorCategory,
            metadata: e.metadata,
            timestamp: e.timestamp.toISOString(),
          }) satisfies BetAuditEntry,
      ),
    });
  });

  return app;
}
