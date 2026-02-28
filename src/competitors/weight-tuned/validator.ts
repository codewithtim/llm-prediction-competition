import { predictionOutputSchema } from "../../domain/contracts/prediction";
import { createWeightedEngine } from "./engine";
import { SAMPLE_STATISTICS_MULTI_MARKET } from "./sample-statistics";
import { validateStake } from "./stake-validator";
import { type StakeConfig, type WeightConfig, weightConfigSchema } from "./types";

export type ValidationResult =
  | { valid: true; weights: WeightConfig }
  | { valid: false; error: string };

export function validateWeights(input: unknown, stakeConfig: StakeConfig): ValidationResult {
  const parsed = weightConfigSchema.safeParse(input);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    return { valid: false, error: `Schema validation failed: ${messages}` };
  }

  const weights = parsed.data;

  const engine = createWeightedEngine(weights, stakeConfig);

  let output: unknown;
  try {
    output = engine(SAMPLE_STATISTICS_MULTI_MARKET);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Engine threw at runtime: ${msg}` };
  }

  if (!Array.isArray(output)) {
    return { valid: false, error: `Engine must return an array, got ${typeof output}` };
  }

  if (output.length === 0) {
    return { valid: false, error: "Engine returned empty predictions array" };
  }

  for (let i = 0; i < output.length; i++) {
    const result = predictionOutputSchema.safeParse(output[i]);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join(", ");
      return { valid: false, error: `Prediction[${i}] validation failed: ${messages}` };
    }

    const stakeResult = validateStake(result.data, stakeConfig.bankroll, stakeConfig);
    if (!stakeResult.valid) {
      return { valid: false, error: `Prediction[${i}] stake issue: ${stakeResult.reason}` };
    }
  }

  return { valid: true, weights };
}
