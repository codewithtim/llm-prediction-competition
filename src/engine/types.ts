import type { PredictionOutput } from "../domain/contracts/prediction";
import type { Statistics } from "../domain/contracts/statistics";

export type PredictionEngine = (
  statistics: Statistics,
) => PredictionOutput[] | Promise<PredictionOutput[]>;

export type EngineResult = {
  competitorId: string;
  predictions: PredictionOutput[];
};

export type EngineError = {
  competitorId: string;
  error: string;
};

export type RegisteredEngine = {
  competitorId: string;
  name: string;
  engine: PredictionEngine;
};
