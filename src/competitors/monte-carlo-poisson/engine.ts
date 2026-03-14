import type { PredictionOutput, Reasoning } from "../../domain/contracts/prediction";
import type { MarketContext, Statistics } from "../../domain/contracts/statistics";
import type { PredictionEngine } from "../../engine/types";
import { classifyMarket } from "../shared/market-classification";
import { estimateLambdas } from "./lambda";
import { simulateMatch } from "./simulator";
import { DEFAULT_MC_CONFIG, type MonteCarloConfig } from "./types";

export function createMonteCarloEngine(config?: Partial<MonteCarloConfig>): PredictionEngine {
  const cfg = { ...DEFAULT_MC_CONFIG, ...config };

  return (statistics: Statistics): PredictionOutput[] => {
    const lambdas = estimateLambdas(statistics);
    const sim = simulateMatch(lambdas.home, lambdas.away, {
      iterations: cfg.simulations,
      rho: cfg.rho,
    });

    type MarketEval = {
      market: MarketContext;
      side: "YES" | "NO";
      confidence: number;
      edge: number;
      modelProb: number;
      marketPrice: number;
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
          modelProb = sim.homeWinPct;
          break;
        case "away":
          modelProb = sim.awayWinPct;
          break;
        case "draw":
          modelProb = sim.drawPct;
          break;
      }

      const yesEdge = modelProb - market.currentYesPrice;
      const noEdge = 1 - modelProb - market.currentNoPrice;

      if (yesEdge >= noEdge) {
        evaluations.push({
          market,
          side: "YES",
          confidence: modelProb,
          edge: yesEdge,
          modelProb,
          marketPrice: market.currentYesPrice,
        });
      } else {
        evaluations.push({
          market,
          side: "NO",
          confidence: 1 - modelProb,
          edge: noEdge,
          modelProb: 1 - modelProb,
          marketPrice: market.currentNoPrice,
        });
      }
    }

    evaluations.sort((a, b) => b.edge - a.edge);
    const best = evaluations[0];
    if (!best || best.edge < cfg.minEdge) return [];

    // Fractional Kelly stake
    const kellyStake =
      best.marketPrice < 1 ? (best.edge * best.confidence) / (1 - best.marketPrice) : 0;

    const rawStake = cfg.kellyFraction * kellyStake;
    const stake = Math.max(cfg.minBetPct, Math.min(cfg.maxBetPct, rawStake));

    const reasoning: Reasoning = {
      summary: `MC-Poisson: ${best.side} edge ${(best.edge * 100).toFixed(1)}% (λ home=${lambdas.home.toFixed(2)}, away=${lambdas.away.toFixed(2)})`,
      sections: [
        {
          label: "Simulation",
          content: `${cfg.simulations} iterations | Home ${(sim.homeWinPct * 100).toFixed(1)}% | Draw ${(sim.drawPct * 100).toFixed(1)}% | Away ${(sim.awayWinPct * 100).toFixed(1)}%`,
          data: {
            iterations: cfg.simulations,
            homeWinPct: sim.homeWinPct,
            drawPct: sim.drawPct,
            awayWinPct: sim.awayWinPct,
          },
        },
        {
          label: "Lambda",
          content: `Home λ=${lambdas.home.toFixed(2)} | Away λ=${lambdas.away.toFixed(2)}`,
          data: {
            lambdaHome: lambdas.home,
            lambdaAway: lambdas.away,
            ...lambdas.components,
          },
        },
        {
          label: "Edge",
          content: `${(best.edge * 100).toFixed(1)}% edge on ${best.side} at ${best.marketPrice.toFixed(2)} | Kelly=${(kellyStake * 100).toFixed(1)}%`,
          data: { edge: best.edge, side: best.side, price: best.marketPrice, kelly: kellyStake },
        },
      ],
    };

    return [
      {
        marketId: best.market.marketId,
        side: best.side,
        confidence: Math.max(0, Math.min(1, best.confidence)),
        stake,
        reasoning,
        extractedFeatures: {
          lambdaHome: lambdas.home,
          lambdaAway: lambdas.away,
          homeWinPct: sim.homeWinPct,
          drawPct: sim.drawPct,
          awayWinPct: sim.awayWinPct,
          simConfidence: sim.confidence,
        },
      },
    ];
  };
}
