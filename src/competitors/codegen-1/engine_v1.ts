import type { PredictionOutput } from "../../domain/contracts/prediction";
import type { Statistics } from "../../domain/contracts/statistics";

const engine = (stats: Statistics): PredictionOutput[] => {
  const market = stats.markets[0];
  if (!market) return [];
  return [
    {
      marketId: market.marketId,
      side: "YES",
      confidence: 0.6,
      stake: 3,
      reasoning: "Test engine",
    },
  ];
};
export default engine;
