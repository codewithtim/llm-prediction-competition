import type { betsRepo } from "../../infrastructure/database/repositories/bets";
import type { competitorVersionsRepo } from "../../infrastructure/database/repositories/competitor-versions";
import type { competitorsRepo } from "../../infrastructure/database/repositories/competitors";
import type { marketsRepo } from "../../infrastructure/database/repositories/markets";
import type { predictionsRepo } from "../../infrastructure/database/repositories/predictions";
import type { CompetitorRegistry } from "../registry";
import {
  buildWeightFeedbackPrompt,
  type LeaderboardEntry,
  type PredictionOutcome,
} from "./feedback";
import type { createWeightGenerator } from "./generator";
import { DEFAULT_WEIGHTS, type StakeConfig, type WeightConfig, weightConfigSchema } from "./types";
import { validateWeights } from "./validator";

export type WeightIterationDeps = {
  generator: ReturnType<typeof createWeightGenerator>;
  competitorsRepo: ReturnType<typeof competitorsRepo>;
  versionsRepo: ReturnType<typeof competitorVersionsRepo>;
  betsRepo: ReturnType<typeof betsRepo>;
  predictionsRepo: ReturnType<typeof predictionsRepo>;
  marketsRepo: ReturnType<typeof marketsRepo>;
  registry: CompetitorRegistry;
  stakeConfig: StakeConfig;
};

export type WeightIterationResult =
  | { success: true; competitorId: string; version: number }
  | { success: false; competitorId: string; error: string };

export function createWeightIterationService(deps: WeightIterationDeps) {
  const {
    generator,
    competitorsRepo: competitors,
    versionsRepo: versions,
    betsRepo: bets,
    predictionsRepo: predictions,
    marketsRepo: markets,
    registry,
    stakeConfig,
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

  function parseCurrentWeights(code: string | null | undefined): WeightConfig {
    if (!code) return DEFAULT_WEIGHTS;
    try {
      const parsed = weightConfigSchema.safeParse(JSON.parse(code));
      return parsed.success ? parsed.data : DEFAULT_WEIGHTS;
    } catch {
      return DEFAULT_WEIGHTS;
    }
  }

  async function iterateCompetitor(competitorId: string): Promise<WeightIterationResult> {
    const competitor = await competitors.findById(competitorId);
    if (!competitor) {
      return { success: false, competitorId, error: `Competitor ${competitorId} not found` };
    }

    try {
      const latestVersion = await versions.findLatest(competitorId);
      const currentWeights = parseCurrentWeights(latestVersion?.code);

      const stats = await bets.getPerformanceStats(competitorId);
      const recentOutcomes = await buildRecentOutcomes(competitorId);
      const leaderboard = await buildLeaderboard();

      let generated: Awaited<ReturnType<typeof generator.generateWeights>>;
      if (!latestVersion) {
        generated = await generator.generateWeights({
          model: competitor.model,
          competitorId,
        });
      } else {
        const feedbackPrompt = buildWeightFeedbackPrompt({
          currentWeights,
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

        generated = await generator.generateWithFeedback({
          model: competitor.model,
          competitorId,
          feedbackPrompt,
        });
      }

      const validation = validateWeights(generated.weights, stakeConfig);
      if (!validation.valid) {
        console.error(`[${competitorId}] Raw LLM output:\n${generated.rawResponse}`);
        return { success: false, competitorId, error: `Validation failed: ${validation.error}` };
      }

      const nextVersion = latestVersion ? latestVersion.version + 1 : 1;

      await versions.create({
        competitorId,
        version: nextVersion,
        code: JSON.stringify(generated.weights),
        rawLlmOutput: generated.rawResponse,
        enginePath: "",
        model: competitor.model,
        performanceSnapshot:
          stats.totalBets > 0
            ? {
                totalBets: stats.totalBets,
                wins: stats.wins,
                losses: stats.losses,
                accuracy: stats.accuracy,
                roi: stats.roi,
                profitLoss: stats.profitLoss,
              }
            : null,
      });

      // Re-register with new weights — the loader will pick these up
      const { createWeightedEngine } = await import("./engine");
      registry.unregister(competitorId);
      registry.register(
        competitorId,
        competitor.name,
        createWeightedEngine(validation.weights, stakeConfig),
      );

      return { success: true, competitorId, version: nextVersion };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[${competitorId}] Iteration failed: ${errorMsg}`);
      return {
        success: false,
        competitorId,
        error: errorMsg,
      };
    }
  }

  async function iterateAll(): Promise<WeightIterationResult[]> {
    const active = await competitors.findByStatus("active");
    const weightTuned = active.filter((c) => c.type === "weight-tuned");

    const results: WeightIterationResult[] = [];
    for (const competitor of weightTuned) {
      const result = await iterateCompetitor(competitor.id);
      results.push(result);
    }

    return results;
  }

  return { buildLeaderboard, iterateCompetitor, iterateAll };
}
