import { type PredictionOutput, predictionOutputSchema } from "../domain/contracts/prediction";

export function validatePredictions(raw: unknown): {
  valid: PredictionOutput[];
  errors: string[];
} {
  if (!Array.isArray(raw)) {
    return { valid: [], errors: ["Expected an array of predictions"] };
  }

  const valid: PredictionOutput[] = [];
  const errors: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const result = predictionOutputSchema.safeParse(raw[i]);
    if (result.success) {
      valid.push(result.data);
    } else {
      const messages = result.error.issues.map((issue) => issue.message).join(", ");
      errors.push(`Prediction[${i}]: ${messages}`);
    }
  }

  return { valid, errors };
}
