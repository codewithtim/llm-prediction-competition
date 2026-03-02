import type { PredictionOutput } from "../../domain/contracts/prediction";
import type { MarketContext, Statistics } from "../../domain/contracts/statistics";
import type { PredictionEngine } from "../../engine/types";
import { clamp, extractFeatures } from "./features";
import type { StakeConfig, WeightConfig } from "./types";

export function classifyMarket(
  question: string,
  homeTeamName: string,
  awayTeamName: string,
): "home" | "away" | "draw" {
  const q = question.toLowerCase();
  const home = homeTeamName.toLowerCase();
  const away = awayTeamName.toLowerCase();

  if (q.includes("draw")) return "draw";

  // Check "<team> win" pattern — the team directly preceding "win" is the subject
  const homeWinPattern = `${home} win`;
  const awayWinPattern = `${away} win`;

  if (q.includes(homeWinPattern) && q.includes(awayWinPattern)) {
    // Both patterns present (unlikely), use first occurrence
    return q.indexOf(homeWinPattern) < q.indexOf(awayWinPattern) ? "home" : "away";
  }
  if (q.includes(homeWinPattern)) return "home";
  if (q.includes(awayWinPattern)) return "away";

  // Fallback: first team mentioned
  const homeIdx = q.indexOf(home);
  const awayIdx = q.indexOf(away);
  if (homeIdx !== -1 && awayIdx !== -1) {
    return homeIdx < awayIdx ? "home" : "away";
  }
  if (homeIdx !== -1) return "home";
  if (awayIdx !== -1) return "away";
  return "home";
}

export function createWeightedEngine(
  weights: WeightConfig,
  stakeConfig: StakeConfig,
): PredictionEngine {
  return (statistics: Statistics): PredictionOutput[] => {
    const features = extractFeatures(statistics);

    // Compute weighted home strength
    let weightedSum = 0;
    let totalWeight = 0;
    for (const [signal, weight] of Object.entries(weights.signals)) {
      const featureValue = features[signal];
      if (featureValue !== undefined && weight > 0) {
        weightedSum += weight * featureValue;
        totalWeight += weight;
      }
    }
    const homeStrength = totalWeight > 0 ? weightedSum / totalWeight : 0.5;

    // Compute draw probability via Gaussian
    const drawProb =
      weights.drawBaseline *
      Math.exp(-((homeStrength - weights.drawPeak) ** 2) / (2 * weights.drawWidth ** 2));

    // Split remaining probability
    const remaining = 1 - drawProb;
    const pHome = remaining * homeStrength;
    const pAway = remaining * (1 - homeStrength);

    // Evaluate each market
    type MarketEval = {
      market: MarketContext;
      side: "YES" | "NO";
      confidence: number;
      edge: number;
      impliedProb: number;
      modelProb: number;
    };

    const evaluations: MarketEval[] = [];

    for (const market of statistics.markets) {
      const classification = classifyMarket(
        market.question,
        statistics.homeTeam.teamName,
        statistics.awayTeam.teamName,
      );

      let modelProb: number;
      switch (classification) {
        case "home":
          modelProb = pHome;
          break;
        case "away":
          modelProb = pAway;
          break;
        case "draw":
          modelProb = drawProb;
          break;
      }

      const yesPrice = market.currentYesPrice;
      const noPrice = market.currentNoPrice;

      // Determine if YES or NO offers value
      const yesEdge = modelProb - yesPrice;
      const noEdge = 1 - modelProb - noPrice;

      if (yesEdge >= noEdge) {
        evaluations.push({
          market,
          side: "YES",
          confidence: modelProb,
          edge: yesEdge,
          impliedProb: yesPrice,
          modelProb,
        });
      } else {
        evaluations.push({
          market,
          side: "NO",
          confidence: 1 - modelProb,
          edge: noEdge,
          impliedProb: noPrice,
          modelProb: 1 - modelProb,
        });
      }
    }

    // Select market with best edge
    evaluations.sort((a, b) => b.edge - a.edge);
    const best = evaluations[0];
    if (!best) return [];

    // Compute stake as fraction of bankroll (0–1)
    const effectiveEdge = Math.max(best.edge, 0);
    const rawStakeFraction = clamp(
      weights.stakingAggression + weights.edgeMultiplier * effectiveEdge,
      0,
      1,
    );

    // Apply confidence threshold: reduce stake if confidence is low
    const confidenceMultiplier =
      best.confidence >= weights.confidenceThreshold
        ? 1
        : best.confidence / weights.confidenceThreshold;

    const stakeFraction = clamp(
      stakeConfig.maxBetPct * rawStakeFraction * confidenceMultiplier,
      stakeConfig.minBetPct,
      stakeConfig.maxBetPct,
    );

    const featuresSummary = Object.entries(features)
      .filter(([name]) => (weights.signals[name] ?? 0) > 0)
      .map(([name, val]) => `${name}=${(val * 100).toFixed(0)}%`)
      .join(", ");

    const reasoning =
      `Strength: ${(homeStrength * 100).toFixed(1)}% | ` +
      `P(home/draw/away): ${(pHome * 100).toFixed(0)}/${(drawProb * 100).toFixed(0)}/${(pAway * 100).toFixed(0)} | ` +
      `Edge: ${(best.edge * 100).toFixed(1)}% | ${featuresSummary}`;

    return [
      {
        marketId: best.market.marketId,
        side: best.side,
        confidence: clamp(best.confidence, 0, 1),
        stake: stakeFraction,
        reasoning: reasoning.slice(0, 500),
      },
    ];
  };
}
