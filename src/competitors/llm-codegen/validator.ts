import { unlink } from "node:fs/promises";
import { predictionOutputSchema } from "../../domain/contracts/prediction.ts";
import type { PredictionEngine } from "../../engine/types.ts";
import { SAMPLE_STATISTICS } from "./sample-statistics.ts";

export type ValidationResult =
  | { valid: true; engine: PredictionEngine }
  | { valid: false; error: string };

export async function validateGeneratedCode(code: string): Promise<ValidationResult> {
  const tmpPath = `/tmp/engine-${crypto.randomUUID()}.ts`;

  try {
    await Bun.write(tmpPath, code);

    let mod: Record<string, unknown>;
    try {
      mod = (await import(tmpPath)) as Record<string, unknown>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { valid: false, error: `Import failed: ${msg}` };
    }

    const engine = mod.default;
    if (typeof engine !== "function") {
      return {
        valid: false,
        error: "Module must export a default function",
      };
    }

    let output: unknown;
    try {
      output = await (engine as PredictionEngine)(SAMPLE_STATISTICS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { valid: false, error: `Engine threw at runtime: ${msg}` };
    }

    if (!Array.isArray(output)) {
      return {
        valid: false,
        error: `Engine must return an array, got ${typeof output}`,
      };
    }

    if (output.length === 0) {
      return {
        valid: false,
        error: "Engine returned empty predictions array",
      };
    }

    for (let i = 0; i < output.length; i++) {
      const result = predictionOutputSchema.safeParse(output[i]);
      if (!result.success) {
        const messages = result.error.issues.map((issue) => issue.message).join(", ");
        return {
          valid: false,
          error: `Prediction[${i}] validation failed: ${messages}`,
        };
      }
    }

    return { valid: true, engine: engine as PredictionEngine };
  } finally {
    try {
      await unlink(tmpPath);
    } catch {
      // Temp file cleanup is best-effort
    }
  }
}
