import type { CompetitorStatus } from "../../domain/types/competitor";
import type { betsRepo } from "../../infrastructure/database/repositories/bets";
import type { competitorVersionsRepo } from "../../infrastructure/database/repositories/competitor-versions";
import type { competitorsRepo } from "../../infrastructure/database/repositories/competitors";
import type { marketsRepo } from "../../infrastructure/database/repositories/markets";
import type { predictionsRepo } from "../../infrastructure/database/repositories/predictions";
import type { CompetitorRegistry } from "../registry";
import {
  buildWeightFeedbackPrompt,
  computeSignalCorrelations,
  type LeaderboardEntry,
  type PerformanceRound,
  type PredictionOutcome,
} from "./feedback";
import type { createWeightGenerator } from "./generator";
import {
  type ChangelogEntry,
  DEFAULT_WEIGHTS,
  type StakeConfig,
  type WeightConfig,
  weightConfigSchema,
} from "./types";
import { validateWeightOutput, validateWeights } from "./validator";

const ITERABLE_STATUSES: CompetitorStatus[] = ["active", "pending"];

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
    const statsMap = await bets.getAllPerformanceStats();

    return active
      .map((c) => {
        const stats = statsMap.get(c.id);
        return {
          name: c.name,
          accuracy: stats?.accuracy ?? 0,
          roi: stats?.roi ?? 0,
          profitLoss: stats?.profitLoss ?? 0,
        };
      })
      .sort((a, b) => b.profitLoss - a.profitLoss);
  }

  async function buildRecentOutcomes(competitorId: string): Promise<PredictionOutcome[]> {
    const allPredictions = await predictions.findByCompetitor(competitorId);
    const allBets = await bets.findByCompetitor(competitorId);

    const betsByMarket = new Map<string, (typeof allBets)[number]>();
    for (const bet of allBets) {
      betsByMarket.set(bet.marketId, bet);
    }

    const marketIds = [...new Set(allPredictions.map((p) => p.marketId))];
    const marketList = await markets.findByIds(marketIds);
    const marketMap = new Map(marketList.map((m) => [m.id, m]));

    const outcomes: PredictionOutcome[] = [];

    for (const pred of allPredictions) {
      const market = marketMap.get(pred.marketId);
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
        extractedFeatures: pred.extractedFeatures ?? undefined,
      });
    }

    return outcomes;
  }

  async function buildPerformanceHistory(competitorId: string): Promise<PerformanceRound[]> {
    const allVersions = await versions.findByCompetitor(competitorId);
    const recent = allVersions.slice(0, 11);
    const rounds: PerformanceRound[] = [];

    for (let i = 0; i < recent.length - 1; i++) {
      const v = recent[i];
      const prev = recent[i + 1];
      if (!v || !prev) continue;
      const snap = v.performanceSnapshot;
      if (!snap || snap.roundWins === undefined) continue;

      rounds.push({
        version: v.version,
        dateFrom: prev.generatedAt.toISOString().split("T")[0] ?? "",
        dateTo: v.generatedAt.toISOString().split("T")[0] ?? "",
        betsSettled: (snap.roundWins ?? 0) + (snap.roundLosses ?? 0),
        wins: snap.roundWins ?? 0,
        losses: snap.roundLosses ?? 0,
        pnl: snap.roundPnl ?? 0,
        avgEdge: snap.avgEdgeAtBet ?? 0,
        winningSignals: snap.winningSignals ?? [],
        losingSignals: snap.losingSignals ?? [],
      });
    }

    return rounds.reverse();
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

  async function iterateCompetitor(
    competitorId: string,
    precomputedLeaderboard?: LeaderboardEntry[],
  ): Promise<WeightIterationResult> {
    const competitor = await competitors.findById(competitorId);
    if (!competitor) {
      return { success: false, competitorId, error: `Competitor ${competitorId} not found` };
    }

    if (!ITERABLE_STATUSES.includes(competitor.status as CompetitorStatus)) {
      return {
        success: false,
        competitorId,
        error: `Competitor ${competitorId} has status "${competitor.status}" — only active and pending competitors can be iterated`,
      };
    }

    try {
      const latestVersion = await versions.findLatest(competitorId);
      const currentWeights = parseCurrentWeights(latestVersion?.code);

      const stats = await bets.getPerformanceStats(competitorId);
      const recentOutcomes = await buildRecentOutcomes(competitorId);
      const leaderboard = precomputedLeaderboard ?? (await buildLeaderboard());

      const signalCorrelations = computeSignalCorrelations(recentOutcomes, currentWeights.signals);
      const performanceHistory = await buildPerformanceHistory(competitorId);

      let generated: Awaited<ReturnType<typeof generator.generateWeights>>;
      let validatedWeights: WeightConfig;
      let reasoning: { changelog: ChangelogEntry[]; overallAssessment: string } | undefined;

      if (!latestVersion) {
        generated = await generator.generateWeights({
          model: competitor.model,
          competitorId,
        });

        const validation = validateWeights(generated.parsed, stakeConfig);
        if (!validation.valid) {
          console.error(`[${competitorId}] Raw LLM output:\n${generated.rawResponse}`);
          return { success: false, competitorId, error: `Validation failed: ${validation.error}` };
        }
        validatedWeights = validation.weights;
      } else {
        const previousReasoning = latestVersion.reasoning ?? undefined;

        const feedbackPrompt = buildWeightFeedbackPrompt({
          currentWeights,
          performance: {
            totalBets: stats.totalBets,
            wins: stats.wins,
            losses: stats.losses,
            accuracy: stats.accuracy,
            roi: stats.roi,
            profitLoss: stats.profitLoss,
            lockedAmount: stats.lockedAmount,
            totalStaked: stats.totalStaked,
            totalReturned: stats.totalReturned,
          },
          recentOutcomes,
          leaderboard,
          performanceHistory,
          signalCorrelations,
          previousReasoning: previousReasoning ?? undefined,
        });

        generated = await generator.generateWithFeedback({
          model: competitor.model,
          competitorId,
          feedbackPrompt,
        });

        const validation = validateWeightOutput(generated.parsed, stakeConfig);
        if (!validation.valid) {
          console.error(`[${competitorId}] Raw LLM output:\n${generated.rawResponse}`);
          return { success: false, competitorId, error: `Validation failed: ${validation.error}` };
        }
        validatedWeights = validation.weights;
        reasoning = {
          changelog: validation.changelog,
          overallAssessment: validation.overallAssessment,
        };
      }

      const nextVersion = latestVersion ? latestVersion.version + 1 : 1;

      const prevSnapshot = latestVersion?.performanceSnapshot;
      const roundWins = prevSnapshot ? stats.wins - (prevSnapshot.wins ?? 0) : stats.wins;
      const roundLosses = prevSnapshot ? stats.losses - (prevSnapshot.losses ?? 0) : stats.losses;
      const roundPnl = prevSnapshot
        ? stats.profitLoss - (prevSnapshot.profitLoss ?? 0)
        : stats.profitLoss;

      await versions.create({
        competitorId,
        version: nextVersion,
        code: JSON.stringify(validatedWeights),
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
                lockedAmount: stats.lockedAmount,
                totalStaked: stats.totalStaked,
                totalReturned: stats.totalReturned,
                roundWins,
                roundLosses,
                roundPnl,
                winningSignals: signalCorrelations.winningSignals,
                losingSignals: signalCorrelations.losingSignals,
              }
            : null,
        reasoning: reasoning ?? null,
      });

      // Re-register with new weights — the loader will pick these up
      const { createWeightedEngine } = await import("./engine");
      registry.unregister(competitorId);
      registry.register(
        competitorId,
        competitor.name,
        createWeightedEngine(validatedWeights, stakeConfig),
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
    const groups = await Promise.all(
      [...ITERABLE_STATUSES].map((s) => competitors.findByStatus(s)),
    );
    const weightTuned = groups.flat().filter((c) => c.type === "weight-tuned");

    const leaderboard = await buildLeaderboard();

    const results: WeightIterationResult[] = [];
    for (const competitor of weightTuned) {
      const result = await iterateCompetitor(competitor.id, leaderboard);
      results.push(result);
    }

    return results;
  }

  return { buildLeaderboard, iterateCompetitor, iterateAll };
}
