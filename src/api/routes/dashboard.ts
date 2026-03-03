import { Hono } from "hono";
import { ACTIVE_BET_STATUSES } from "../../domain/models/prediction";
import type { ApiDeps } from "../index";
import { toBetSummary } from "../mappers";

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
    const activeStatuses = new Set<string>(ACTIVE_BET_STATUSES);
    const pendingBets = allBets.filter((b) => activeStatuses.has(b.status));

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
    const lookups = {
      competitorMap: new Map(allCompetitors.map((c) => [c.id, c.name])),
      marketById: new Map(allMarkets.map((m) => [m.id, m])),
      predictionMap: new Map(
        allPredictions.map((p) => [`${p.competitorId}:${p.marketId}:${p.side}`, p.confidence]),
      ),
    };

    const recentBets = recentBetsRaw.map((b) => toBetSummary(b, lookups));

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
