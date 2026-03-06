import { Hono } from "hono";
import { getUsdcBalance } from "../../apis/polymarket/balance-client";
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

    const statsMap = await deps.betsRepo.getAllPerformanceStats();
    const emptyStats = {
      totalBets: 0,
      wins: 0,
      losses: 0,
      pending: 0,
      failed: 0,
      lockedAmount: 0,
      totalStaked: 0,
      totalReturned: 0,
      profitLoss: 0,
      accuracy: 0,
      roi: 0,
    };

    // Fetch on-chain balances in parallel for wallets
    const balanceEntries = await Promise.all(
      walletList.map(async (w) => [w.competitorId, await getUsdcBalance(w.walletAddress)] as const),
    );
    const balanceMap = new Map(balanceEntries);

    const results = allCompetitors.map((comp) => {
      const stats = statsMap.get(comp.id) ?? emptyStats;
      return {
        id: comp.id,
        name: comp.name,
        model: comp.model,
        status: comp.status,
        type: comp.type,
        hasWallet: walletMap.has(comp.id),
        walletAddress: walletMap.get(comp.id) ?? null,
        onChainBalance: balanceMap.get(comp.id) ?? null,
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
    });

    return c.json(results);
  });

  app.get("/competitors/:id", async (c) => {
    const id = c.req.param("id");
    const comp = await deps.competitorsRepo.findById(id);
    if (!comp) return c.json({ error: "Competitor not found" }, 404);

    const walletList = await deps.walletsRepo.listAll();
    const walletMap = new Map(walletList.map((w) => [w.competitorId, w.walletAddress]));

    const walletAddress = walletMap.get(comp.id) ?? null;

    const [stats, versions, bets, predictions, onChainBalance, computedBankroll] =
      await Promise.all([
        deps.betsRepo.getPerformanceStats(id),
        deps.competitorVersionsRepo.findByCompetitor(id),
        deps.betsRepo.findByCompetitor(id),
        deps.predictionsRepo.findByCompetitor(id),
        walletAddress ? getUsdcBalance(walletAddress) : Promise.resolve(null),
        deps.bankrollProvider.getBankroll(id),
      ]);

    const marketIds = [
      ...new Set([...bets.map((b) => b.marketId), ...predictions.map((p) => p.marketId)]),
    ];
    const marketList = await deps.marketsRepo.findByIds(marketIds);
    const marketById = new Map(marketList.map((m) => [m.id, m]));

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
      walletAddress,
      onChainBalance,
      computedBankroll,
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
        overallAssessment: v.reasoning?.overallAssessment ?? null,
        generatedAt: v.generatedAt?.toISOString() ?? "",
      })),
      recentBets: bets.slice(0, 20).map((b) => toBetSummary(b, lookups)),
      recentPredictions: predictions.slice(0, 20).map((p) => ({
        id: p.id,
        competitorId: p.competitorId,
        competitorName: lookups.competitorMap.get(p.competitorId) ?? "Unknown",
        marketId: p.marketId,
        marketQuestion: marketById.get(p.marketId)?.question ?? "Unknown",
        polymarketUrl: marketById.get(p.marketId)?.polymarketUrl ?? null,
        fixtureId: p.fixtureId,
        side: p.side,
        confidence: p.confidence,
        stake: p.stake,
        reasoning: p.reasoning,
        createdAt: p.createdAt?.toISOString() ?? "",
      })),
    });
  });

  app.get("/competitors/:id/bankroll-history", async (c) => {
    const id = c.req.param("id");
    const comp = await deps.competitorsRepo.findById(id);
    if (!comp) return c.json({ error: "Competitor not found" }, 404);

    const allBets = await deps.betsRepo.findByCompetitor(id);
    const settledBets = allBets
      .filter(
        (b) => (b.status === "settled_won" || b.status === "settled_lost") && b.settledAt != null,
      )
      .sort((a, b) => (a.settledAt?.getTime() ?? 0) - (b.settledAt?.getTime() ?? 0));

    let running = deps.initialBankroll;
    const dataPoints = settledBets.map((b) => {
      running += b.profit ?? 0;
      return {
        date: b.settledAt?.toISOString() ?? "",
        bankroll: Math.round(running * 100) / 100,
      };
    });

    return c.json(dataPoints);
  });

  app.get("/competitors/:id/versions/:version", async (c) => {
    const id = c.req.param("id");
    const versionNum = Number(c.req.param("version"));
    if (Number.isNaN(versionNum)) return c.json({ error: "Invalid version" }, 400);

    const version = await deps.competitorVersionsRepo.findByVersion(id, versionNum);
    if (!version) return c.json({ error: "Version not found" }, 404);

    let weights: Record<string, number | Record<string, number>> = {};
    try {
      const parsed = JSON.parse(version.code);
      if (parsed && typeof parsed === "object") {
        weights = parsed;
      }
    } catch {
      // code may not be JSON (e.g. raw source) — leave weights empty
    }

    return c.json({
      id: version.id,
      version: version.version,
      model: version.model,
      enginePath: version.enginePath,
      generatedAt: version.generatedAt?.toISOString() ?? "",
      performanceSnapshot: version.performanceSnapshot,
      weights,
      changelog: version.reasoning?.changelog ?? [],
      overallAssessment: version.reasoning?.overallAssessment ?? null,
    });
  });

  return app;
}
