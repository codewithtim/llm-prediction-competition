import { Hono } from "hono";
import type { ApiDeps } from "../index";

export function dashboardRoutes(deps: ApiDeps) {
  const app = new Hono();

  app.get("/dashboard", async (c) => {
    const [allCompetitors, allFixtures, allMarkets, allBets, recentBetsRaw, allPredictions] =
      await Promise.all([
        deps.competitorsRepo.findAll(),
        deps.fixturesRepo.findAll(),
        deps.marketsRepo.findAll(),
        deps.betsRepo.findAll(),
        deps.betsRepo.findRecent(10),
        deps.predictionsRepo.findAll(),
      ]);

    const walletList = await deps.walletsRepo.listAll();
    const walletSet = new Set(walletList.map((w) => w.competitorId));

    const activeCompetitors = allCompetitors.filter((c) => c.status === "active");
    const activeMarkets = allMarkets.filter((m) => m.active);
    const pendingBets = allBets.filter(
      (b) => b.status === "submitting" || b.status === "pending" || b.status === "filled",
    );

    // Build leaderboard
    const leaderboard = await Promise.all(
      allCompetitors.map(async (comp) => {
        const stats = await deps.betsRepo.getPerformanceStats(comp.id);
        return {
          competitor: {
            id: comp.id,
            name: comp.name,
            model: comp.model,
            status: comp.status,
            type: comp.type,
            hasWallet: walletSet.has(comp.id),
            walletAddress: null as string | null,
            createdAt: comp.createdAt?.toISOString() ?? "",
            stats: {
              totalBets: stats.totalBets,
              wins: stats.wins,
              losses: stats.losses,
              pending: stats.pending,
              failed: stats.failed,
              lockedAmount: stats.lockedAmount,
              totalStaked: stats.totalStaked,
              totalReturned: stats.totalReturned,
              profitLoss: stats.profitLoss,
              accuracy: stats.accuracy,
              roi: stats.roi,
            },
          },
          rank: 0,
        };
      }),
    );

    leaderboard.sort((a, b) => b.competitor.stats.profitLoss - a.competitor.stats.profitLoss);
    for (let i = 0; i < leaderboard.length; i++) {
      const entry = leaderboard[i];
      if (entry) entry.rank = i + 1;
    }

    // Enrich recent bets
    const competitorMap = new Map(allCompetitors.map((c) => [c.id, c.name]));
    const marketById = new Map(allMarkets.map((m) => [m.id, m]));
    const predictionMap = new Map(
      allPredictions.map((p) => [`${p.competitorId}:${p.marketId}:${p.side}`, p.confidence]),
    );

    const recentBets = recentBetsRaw.map((b) => ({
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
    }));

    // Aggregate totals
    const totalProfitLoss = leaderboard.reduce((sum, e) => sum + e.competitor.stats.profitLoss, 0);
    const totalWins = leaderboard.reduce((sum, e) => sum + e.competitor.stats.wins, 0);
    const totalSettled = leaderboard.reduce(
      (sum, e) => sum + e.competitor.stats.wins + e.competitor.stats.losses,
      0,
    );
    const failedBets = allBets.filter((b) => b.status === "failed").length;
    const lockedAmount = leaderboard.reduce((sum, e) => sum + e.competitor.stats.lockedAmount, 0);

    return c.json({
      totalCompetitors: allCompetitors.length,
      activeCompetitors: activeCompetitors.length,
      totalFixtures: allFixtures.length,
      totalMarkets: allMarkets.length,
      activeMarkets: activeMarkets.length,
      totalBets: allBets.length,
      pendingBets: pendingBets.length,
      failedBets,
      lockedAmount,
      totalProfitLoss: totalProfitLoss,
      overallAccuracy: totalSettled > 0 ? totalWins / totalSettled : 0,
      leaderboard,
      recentBets,
    });
  });

  return app;
}
