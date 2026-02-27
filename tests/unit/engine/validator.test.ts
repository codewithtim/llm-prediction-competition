import { describe, expect, it } from "bun:test";
import { validatePredictions } from "../../../src/engine/validator";

function makeValidPrediction(overrides?: Record<string, unknown>) {
  return {
    marketId: "market-1",
    side: "YES",
    confidence: 0.75,
    stake: 5.0,
    reasoning: "Strong home form and H2H advantage",
    ...overrides,
  };
}

describe("validatePredictions", () => {
  it("returns valid single prediction", () => {
    const result = validatePredictions([makeValidPrediction()]);
    expect(result.valid).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.valid[0]?.marketId).toBe("market-1");
  });

  it("returns valid array of multiple predictions", () => {
    const result = validatePredictions([
      makeValidPrediction({ marketId: "m1" }),
      makeValidPrediction({ marketId: "m2", side: "NO" }),
    ]);
    expect(result.valid).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it("puts invalid prediction (missing field) in errors", () => {
    const { marketId: _, ...noMarketId } = makeValidPrediction();
    const result = validatePredictions([noMarketId]);
    expect(result.valid).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Prediction[0]");
  });

  it("separates valid and invalid predictions in mixed array", () => {
    const { marketId: _, ...invalid } = makeValidPrediction();
    const result = validatePredictions([
      makeValidPrediction(),
      invalid,
      makeValidPrediction({ marketId: "m2" }),
    ]);
    expect(result.valid).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Prediction[1]");
  });

  it("returns error for non-array input", () => {
    const result = validatePredictions("not an array");
    expect(result.valid).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Expected an array");
  });

  it("returns empty valid array for empty input array", () => {
    const result = validatePredictions([]);
    expect(result.valid).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("puts confidence out of range in errors", () => {
    const result = validatePredictions([makeValidPrediction({ confidence: 1.5 })]);
    expect(result.valid).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Prediction[0]");
  });

  it("puts invalid side value in errors", () => {
    const result = validatePredictions([makeValidPrediction({ side: "MAYBE" })]);
    expect(result.valid).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Prediction[0]");
  });
});
