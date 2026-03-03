import { Hono } from "hono";
import type { ApiDeps } from "../index";
import { toBetSummary } from "../mappers";

export function competitorsRoutes(deps: ApiDeps) {
  const app = new Hono();

  app.get("/competitors", async (c) => {
    const status = c.req.query("status");

    const allCompetitors = status
      ? await deps.competitorsRepo.findByStatus(
          status as "active" | "disabled" | "pending" | "error",
        )
      : await deps.competitorsRepo.findAll();

    const walletList = await deps.walletsRepo.listAll();
    const walletMap = new Map(walletList.map((w) => [w.competitorId, w.walletAddress]));

    const results = await Promise.all(
      allCompetitors.map(async (comp) => {
        const stats = await deps.betsRepo.getPerformanceStats(comp.id);
        return {
          id: comp.id,
          name: comp.name,
          model: comp.model,
          status: comp.status,
          type: comp.type,
          hasWallet: walletMap.has(comp.id),
          walletAddress: walletMap.get(comp.id) ?? null,
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
        };
      }),
    );

    return c.json(results);
  });

  app.get("/competitors/:id", async (c) => {
    const id = c.req.param("id");
    const comp = await deps.competitorsRepo.findById(id);
    if (!comp) return c.json({ error: "Competitor not found" }, 404);

    const walletList = await deps.walletsRepo.listAll();
    const walletMap = new Map(walletList.map((w) => [w.competitorId, w.walletAddress]));

    const [stats, versions, bets, predictions] = await Promise.all([
      deps.betsRepo.getPerformanceStats(id),
      deps.competitorVersionsRepo.findByCompetitor(id),
      deps.betsRepo.findByCompetitor(id),
      deps.predictionsRepo.findByCompetitor(id),
    ]);

    const marketIds = [
      ...new Set([...bets.map((b) => b.marketId), ...predictions.map((p) => p.marketId)]),
    ];
    const marketById = new Map<string, { question: string; polymarketUrl: string | null }>();
    for (const mid of marketIds) {
      const m = await deps.marketsRepo.findById(mid);
      if (m) marketById.set(m.id, m);
    }

    const lookups = {
      competitorMap: new Map([[comp.id, comp.name]]),
      marketById,
      predictionMap: new Map(
        predictions.map((p) => [`${p.competitorId}:${p.marketId}:${p.side}`, p.confidence]),
      ),
    };

    return c.json({
      id: comp.id,
      name: comp.name,
      model: comp.model,
      status: comp.status,
      type: comp.type,
      hasWallet: walletMap.has(comp.id),
      walletAddress: walletMap.get(comp.id) ?? null,
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
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        model: v.model,
        enginePath: v.enginePath,
        performanceSnapshot: v.performanceSnapshot,
        generatedAt: v.generatedAt?.toISOString() ?? "",
      })),
      recentBets: bets.slice(0, 20).map((b) => toBetSummary(b, lookups)),
      recentPredictions: predictions.slice(0, 20).map((p) => ({
        id: p.id,
        competitorId: p.competitorId,
        competitorName: lookups.competitorMap.get(p.competitorId) ?? "Unknown",
        marketId: p.marketId,
        marketQuestion: marketById.get(p.marketId)?.question ?? "Unknown",
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
