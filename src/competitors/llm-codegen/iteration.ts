import type { betsRepo } from "../../infrastructure/database/repositories/bets.ts";
import type { competitorVersionsRepo } from "../../infrastructure/database/repositories/competitor-versions.ts";
import type { competitorsRepo } from "../../infrastructure/database/repositories/competitors.ts";
import type { marketsRepo } from "../../infrastructure/database/repositories/markets.ts";
import type { predictionsRepo } from "../../infrastructure/database/repositories/predictions.ts";
import type { CompetitorRegistry } from "../registry.ts";
import { loadCodegenEngine, saveGeneratedEngine } from "./engine.ts";
import { buildFeedbackPrompt, type LeaderboardEntry, type PredictionOutcome } from "./feedback.ts";
import type { createCodeGenerator } from "./generator.ts";

export type IterationDeps = {
  generator: ReturnType<typeof createCodeGenerator>;
  competitorsRepo: ReturnType<typeof competitorsRepo>;
  versionsRepo: ReturnType<typeof competitorVersionsRepo>;
  betsRepo: ReturnType<typeof betsRepo>;
  predictionsRepo: ReturnType<typeof predictionsRepo>;
  marketsRepo: ReturnType<typeof marketsRepo>;
  registry: CompetitorRegistry;
};

export type IterationResult =
  | {
      success: true;
      competitorId: string;
      version: number;
      enginePath: string;
    }
  | {
      success: false;
      competitorId: string;
      error: string;
    };

export function createIterationService(deps: IterationDeps) {
  const {
    generator,
    competitorsRepo: competitors,
    versionsRepo: versions,
    betsRepo: bets,
    predictionsRepo: predictions,
    marketsRepo: markets,
    registry,
  } = deps;

  async function buildLeaderboard(): Promise<LeaderboardEntry[]> {
    const active = await competitors.findByStatus("active");
    const entries: LeaderboardEntry[] = [];

    for (const competitor of active) {
      const stats = await bets.getPerformanceStats(competitor.id);
      entries.push({
        name: competitor.name,
        accuracy: stats.accuracy,
        roi: stats.roi,
        profitLoss: stats.profitLoss,
      });
    }

    return entries.sort((a, b) => b.profitLoss - a.profitLoss);
  }

  async function buildRecentOutcomes(competitorId: string): Promise<PredictionOutcome[]> {
    const allPredictions = await predictions.findByCompetitor(competitorId);
    const allBets = await bets.findByCompetitor(competitorId);

    const betsByMarket = new Map<string, (typeof allBets)[number]>();
    for (const bet of allBets) {
      betsByMarket.set(bet.marketId, bet);
    }

    const outcomes: PredictionOutcome[] = [];

    for (const pred of allPredictions) {
      const market = await markets.findById(pred.marketId);
      const bet = betsByMarket.get(pred.marketId);

      let result: "won" | "lost" | "pending" = "pending";
      let profit: number | null = null;

      if (bet) {
        if (bet.status === "settled_won") {
          result = "won";
          profit = bet.profit;
        } else if (bet.status === "settled_lost") {
          result = "lost";
          profit = bet.profit;
        }
      }

      outcomes.push({
        marketQuestion: market?.question ?? pred.marketId,
        side: pred.side,
        confidence: pred.confidence,
        stake: pred.stake,
        result,
        profit,
      });
    }

    return outcomes;
  }

  async function iterateCompetitor(competitorId: string): Promise<IterationResult> {
    const competitor = await competitors.findById(competitorId);
    if (!competitor) {
      return {
        success: false,
        competitorId,
        error: `Competitor ${competitorId} not found`,
      };
    }

    try {
      if (!competitor.enginePath) {
        return {
          success: false,
          competitorId,
          error: `Competitor ${competitorId} has no engine path`,
        };
      }
      const currentCode = await Bun.file(competitor.enginePath).text();

      const stats = await bets.getPerformanceStats(competitorId);
      const recentOutcomes = await buildRecentOutcomes(competitorId);
      const leaderboard = await buildLeaderboard();

      const feedbackPrompt = buildFeedbackPrompt({
        currentCode,
        performance: {
          totalBets: stats.totalBets,
          wins: stats.wins,
          losses: stats.losses,
          accuracy: stats.accuracy,
          roi: stats.roi,
          profitLoss: stats.profitLoss,
        },
        recentOutcomes,
        leaderboard,
      });

      const generated = await generator.generateWithFeedback({
        model: competitor.model,
        competitorId,
        feedbackPrompt,
      });

      const { validateGeneratedCode } = await import("./validator.ts");
      const validation = await validateGeneratedCode(generated.code);

      if (!validation.valid) {
        return {
          success: false,
          competitorId,
          error: `Validation failed: ${validation.error}`,
        };
      }

      const latestVersion = await versions.findLatest(competitorId);
      const nextVersion = latestVersion ? latestVersion.version + 1 : 1;

      const enginePath = await saveGeneratedEngine({
        competitorId,
        code: generated.code,
        version: nextVersion,
      });

      await versions.create({
        competitorId,
        version: nextVersion,
        code: generated.code,
        enginePath,
        model: competitor.model,
        performanceSnapshot: {
          totalBets: stats.totalBets,
          wins: stats.wins,
          losses: stats.losses,
          accuracy: stats.accuracy,
          roi: stats.roi,
          profitLoss: stats.profitLoss,
        },
      });

      await competitors.updateEnginePath(competitorId, enginePath);

      registry.unregister(competitorId);
      const newEngine = await loadCodegenEngine(enginePath);
      registry.register(competitorId, competitor.name, newEngine);

      return {
        success: true,
        competitorId,
        version: nextVersion,
        enginePath,
      };
    } catch (err) {
      return {
        success: false,
        competitorId,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async function iterateAll(): Promise<IterationResult[]> {
    const active = await competitors.findByStatus("active");
    const codegenCompetitors = active.filter((c) => c.type === "codegen");

    const results: IterationResult[] = [];

    for (const competitor of codegenCompetitors) {
      const result = await iterateCompetitor(competitor.id);
      results.push(result);
    }

    return results;
  }

  return { buildLeaderboard, iterateCompetitor, iterateAll };
}
