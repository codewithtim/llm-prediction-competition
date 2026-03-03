import { Hono } from "hono";
import type { ApiDeps } from "../index";

export function fixturesRoutes(deps: ApiDeps) {
  const app = new Hono();

  app.get("/fixtures", async (c) => {
    const status = c.req.query("status");

    const allFixtures = status
      ? await deps.fixturesRepo.findByStatus(
          status as "scheduled" | "in_progress" | "finished" | "postponed" | "cancelled",
        )
      : await deps.fixturesRepo.findAll();

    const allMarkets = await deps.marketsRepo.findAll();
    const marketCountByFixture = new Map<number, number>();
    for (const m of allMarkets) {
      if (m.fixtureId != null) {
        marketCountByFixture.set(m.fixtureId, (marketCountByFixture.get(m.fixtureId) ?? 0) + 1);
      }
    }

    return c.json(
      allFixtures.map((f) => ({
        id: f.id,
        leagueName: f.leagueName,
        leagueCountry: f.leagueCountry,
        homeTeamName: f.homeTeamName,
        awayTeamName: f.awayTeamName,
        date: f.date,
        venue: f.venue,
        status: f.status,
        marketCount: marketCountByFixture.get(f.id) ?? 0,
      })),
    );
  });

  app.get("/fixtures/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const fixture = await deps.fixturesRepo.findById(id);
    if (!fixture) return c.json({ error: "Fixture not found" }, 404);

    const [fixtureMarkets, fixturePredictions] = await Promise.all([
      deps.marketsRepo.findByFixtureId(id),
      deps.predictionsRepo.findAll().then((all) => all.filter((p) => p.fixtureId === id)),
    ]);

    const allCompetitors = await deps.competitorsRepo.findAll();
    const competitorMap = new Map(allCompetitors.map((c) => [c.id, c.name]));
    const marketMap = new Map(fixtureMarkets.map((m) => [m.id, m.question]));

    return c.json({
      id: fixture.id,
      leagueId: fixture.leagueId,
      leagueName: fixture.leagueName,
      leagueCountry: fixture.leagueCountry,
      leagueSeason: fixture.leagueSeason,
      homeTeamId: fixture.homeTeamId,
      homeTeamName: fixture.homeTeamName,
      homeTeamLogo: fixture.homeTeamLogo,
      awayTeamId: fixture.awayTeamId,
      awayTeamName: fixture.awayTeamName,
      awayTeamLogo: fixture.awayTeamLogo,
      date: fixture.date,
      venue: fixture.venue,
      status: fixture.status,
      markets: fixtureMarkets.map((m) => ({
        id: m.id,
        polymarketUrl: m.polymarketUrl ?? null,
        question: m.question,
        outcomes: m.outcomes,
        outcomePrices: m.outcomePrices,
        active: m.active,
        closed: m.closed,
        liquidity: m.liquidity,
        volume: m.volume,
        fixtureId: m.fixtureId,
        fixtureSummary: `${fixture.homeTeamName} vs ${fixture.awayTeamName}`,
        sportsMarketType: m.sportsMarketType,
        status: m.closed ? "closed" : m.active ? "active" : "inactive",
      })),
      predictions: fixturePredictions.map((p) => ({
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
    });
  });

  return app;
}
