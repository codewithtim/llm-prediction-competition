import type { PredictionOutput, Reasoning } from "../../domain/contracts/prediction";
import type { MarketContext, Statistics } from "../../domain/contracts/statistics";
import type { PredictionEngine } from "../../engine/types";
import { logger } from "../../shared/logger";
import { classifyMarket } from "../shared/market-classification";
import { clamp, extractFeatures, getMissingSignals } from "./features";
import type { StakeConfig, WeightConfig } from "./types";

export { classifyMarket } from "../shared/market-classification";

export function createWeightedEngine(
  weights: WeightConfig,
  stakeConfig: StakeConfig,
): PredictionEngine {
  const missing = getMissingSignals(weights.signals);
  if (missing.length > 0) {
    logger.warn("Weight config is missing signals, defaulting to 0", { missing });
    for (const name of missing) {
      weights.signals[name] = 0;
    }
  }

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

    // Split remaining probability using a power curve to amplify strong favourites.
    // Linear split (sharpness=1): 0.65 strength → 55%/30% — too flat, underdog always gets ~30%.
    // Power curve (sharpness=2.5): 0.65 strength → ~68%/17% — matches real-world distributions.
    const remaining = 1 - drawProb;
    const homePower = homeStrength ** weights.sharpness;
    const awayPower = (1 - homeStrength) ** weights.sharpness;
    const powerTotal = homePower + awayPower;
    const pHome = remaining * (homePower / powerTotal);
    const pAway = remaining * (awayPower / powerTotal);

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

    // Select market with best edge, filtering by minEdge
    evaluations.sort((a, b) => b.edge - a.edge);
    const best = evaluations[0];
    if (!best || best.edge < weights.minEdge) return [];

    // Fractional Kelly stake: kellyFraction * (p * b - q) / b
    // where p = model prob, q = 1-p, b = decimal odds - 1 = (1/price) - 1
    const p = best.confidence;
    const q = 1 - p;
    const b = 1 / best.impliedProb - 1;
    const fullKelly = b > 0 ? Math.max(0, (p * b - q) / b) : 0;
    const kellyStake = weights.kellyFraction * fullKelly;

    const stakeFraction = clamp(kellyStake, stakeConfig.minBetPct, stakeConfig.maxBetPct);

    const signalEntries = Object.entries(features).filter(
      ([name]) => (weights.signals[name] ?? 0) > 0,
    );
    const featuresSummary = signalEntries
      .map(([name, val]) => `${name}=${(val * 100).toFixed(0)}%`)
      .join(", ");

    const reasoning: Reasoning = {
      summary: `${best.side} edge ${(best.edge * 100).toFixed(1)}% at ${(homeStrength * 100).toFixed(1)}% strength`,
      sections: [
        {
          label: "Probability",
          content: `Home ${(pHome * 100).toFixed(0)}% | Draw ${(drawProb * 100).toFixed(0)}% | Away ${(pAway * 100).toFixed(0)}%`,
          data: { home: pHome, draw: drawProb, away: pAway },
        },
        {
          label: "Signals",
          content: featuresSummary,
          data: Object.fromEntries(signalEntries),
        },
        {
          label: "Edge",
          content: `${(best.edge * 100).toFixed(1)}% edge on ${best.side} at ${best.impliedProb.toFixed(2)}`,
          data: { edge: best.edge, side: best.side, price: best.impliedProb },
        },
      ],
    };

    return [
      {
        marketId: best.market.marketId,
        side: best.side,
        confidence: clamp(best.confidence, 0, 1),
        stake: stakeFraction,
        reasoning,
        extractedFeatures: features,
      },
    ];
  };
}
