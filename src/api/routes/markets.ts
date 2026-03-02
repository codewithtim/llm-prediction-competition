import { Hono } from "hono";
import type { ApiDeps } from "../index";

export function marketsRoutes(deps: ApiDeps) {
  const app = new Hono();

  app.get("/markets", async (c) => {
    const activeFilter = c.req.query("active");
    const closedFilter = c.req.query("closed");

    let allMarkets = await deps.marketsRepo.findAll();

    if (activeFilter !== undefined) {
      const isActive = activeFilter === "true";
      allMarkets = allMarkets.filter((m) => m.active === isActive);
    }
    if (closedFilter !== undefined) {
      const isClosed = closedFilter === "true";
      allMarkets = allMarkets.filter((m) => m.closed === isClosed);
    }

    const allFixtures = await deps.fixturesRepo.findAll();
    const fixtureMap = new Map(
      allFixtures.map((f) => [f.id, `${f.homeTeamName} vs ${f.awayTeamName}`]),
    );

    return c.json(
      allMarkets.map((m) => ({
        id: m.id,
        question: m.question,
        outcomes: m.outcomes,
        outcomePrices: m.outcomePrices,
        active: m.active,
        closed: m.closed,
        liquidity: m.liquidity,
        volume: m.volume,
        fixtureId: m.fixtureId,
        fixtureSummary: m.fixtureId ? (fixtureMap.get(m.fixtureId) ?? null) : null,
        sportsMarketType: m.sportsMarketType,
        status: m.closed ? "closed" : m.active ? "active" : "inactive",
      })),
    );
  });

  return app;
}
