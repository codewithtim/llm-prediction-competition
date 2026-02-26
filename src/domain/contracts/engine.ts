import type { PredictionOutput } from "./prediction";
import type { Statistics } from "./statistics";

export type PredictionEngine = (
  statistics: Statistics,
) => PredictionOutput | Promise<PredictionOutput>;
