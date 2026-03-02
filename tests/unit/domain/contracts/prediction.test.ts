import { describe, expect, it } from "bun:test";
import { predictionOutputSchema } from "../../../../src/domain/contracts/prediction";

function makeValidPrediction(overrides?: Record<string, unknown>) {
  return {
    marketId: "abc-123",
    side: "YES",
    confidence: 0.75,
    stake: 0.05,
    reasoning: "Home team has strong form and H2H advantage",
    ...overrides,
  };
}

describe("predictionOutputSchema", () => {
  it("accepts valid prediction", () => {
    expect(() => predictionOutputSchema.parse(makeValidPrediction())).not.toThrow();
  });

  it("accepts NO side", () => {
    expect(() => predictionOutputSchema.parse(makeValidPrediction({ side: "NO" }))).not.toThrow();
  });

  it("accepts confidence at boundaries", () => {
    expect(() =>
      predictionOutputSchema.parse(makeValidPrediction({ confidence: 0 })),
    ).not.toThrow();
    expect(() =>
      predictionOutputSchema.parse(makeValidPrediction({ confidence: 1 })),
    ).not.toThrow();
  });

  it("rejects confidence > 1", () => {
    expect(() => predictionOutputSchema.parse(makeValidPrediction({ confidence: 1.5 }))).toThrow();
  });

  it("rejects confidence < 0", () => {
    expect(() => predictionOutputSchema.parse(makeValidPrediction({ confidence: -0.1 }))).toThrow();
  });

  it("rejects negative stake", () => {
    expect(() => predictionOutputSchema.parse(makeValidPrediction({ stake: -1 }))).toThrow();
  });

  it("accepts zero stake fraction", () => {
    expect(() => predictionOutputSchema.parse(makeValidPrediction({ stake: 0 }))).not.toThrow();
  });

  it("rejects stake fraction > 1", () => {
    expect(() => predictionOutputSchema.parse(makeValidPrediction({ stake: 1.5 }))).toThrow();
  });

  it("accepts stake fraction at boundaries", () => {
    expect(() => predictionOutputSchema.parse(makeValidPrediction({ stake: 0 }))).not.toThrow();
    expect(() => predictionOutputSchema.parse(makeValidPrediction({ stake: 1 }))).not.toThrow();
  });

  it("rejects empty reasoning", () => {
    expect(() => predictionOutputSchema.parse(makeValidPrediction({ reasoning: "" }))).toThrow();
  });

  it("rejects reasoning over 500 characters", () => {
    expect(() =>
      predictionOutputSchema.parse(makeValidPrediction({ reasoning: "x".repeat(501) })),
    ).toThrow();
  });

  it("rejects invalid side", () => {
    expect(() => predictionOutputSchema.parse(makeValidPrediction({ side: "MAYBE" }))).toThrow();
  });

  it("rejects missing marketId", () => {
    const { marketId: _, ...rest } = makeValidPrediction();
    expect(() => predictionOutputSchema.parse(rest)).toThrow();
  });
});
