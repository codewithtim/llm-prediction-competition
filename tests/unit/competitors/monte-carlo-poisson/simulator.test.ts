import { describe, expect, it } from "bun:test";
import { samplePoisson, simulateMatch } from "../../../../src/competitors/monte-carlo-poisson/simulator";

describe("samplePoisson", () => {
  it("returns non-negative integers", () => {
    for (let i = 0; i < 100; i++) {
      const val = samplePoisson(1.5);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(val)).toBe(true);
    }
  });
});

describe("simulateMatch", () => {
  it("produces deterministic results with seed", () => {
    const a = simulateMatch(1.5, 1.2, { seed: 42 });
    const b = simulateMatch(1.5, 1.2, { seed: 42 });
    expect(a.homeWinPct).toBe(b.homeWinPct);
    expect(a.drawPct).toBe(b.drawPct);
    expect(a.awayWinPct).toBe(b.awayWinPct);
  });

  it("probabilities sum to 1.0", () => {
    const result = simulateMatch(1.5, 1.2, { seed: 42 });
    expect(result.homeWinPct + result.drawPct + result.awayWinPct).toBeCloseTo(1, 10);
  });

  it("heavy favourite produces > 80% home win", () => {
    const result = simulateMatch(3.0, 0.5, { seed: 42, iterations: 10_000 });
    expect(result.homeWinPct).toBeGreaterThan(0.8);
  });

  it("equal teams produce roughly symmetric results", () => {
    const result = simulateMatch(1.5, 1.5, { seed: 42, iterations: 10_000 });
    expect(Math.abs(result.homeWinPct - result.awayWinPct)).toBeLessThan(0.05);
    expect(result.drawPct).toBeGreaterThan(0.15);
  });

  it("score distribution contains common scorelines", () => {
    const result = simulateMatch(1.5, 1.2, { seed: 42, iterations: 10_000 });
    // At least some common scorelines should appear
    const hasCommon = result.scoreDistribution.has("1-0") || result.scoreDistribution.has("1-1") || result.scoreDistribution.has("0-0");
    expect(hasCommon).toBe(true);
  });

  it("confidence is between 0 and 1", () => {
    const result = simulateMatch(1.5, 1.2, { seed: 42 });
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("high confidence for heavy favourite", () => {
    const result = simulateMatch(3.0, 0.5, { seed: 42, iterations: 10_000 });
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});
