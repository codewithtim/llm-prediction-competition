import { describe, expect, it } from "bun:test";
import {
  buildScoreMatrix,
  dixonColesAdjustment,
  outcomeProbabilities,
  poissonCdf,
  poissonPmf,
} from "../../../../src/competitors/monte-carlo-poisson/poisson";

describe("poissonPmf", () => {
  it("returns correct value for lambda=1, k=0", () => {
    expect(poissonPmf(1, 0)).toBeCloseTo(0.3679, 3);
  });

  it("returns correct value for lambda=2.5, k=3", () => {
    expect(poissonPmf(2.5, 3)).toBeCloseTo(0.2138, 3);
  });

  it("returns 1 for lambda=0, k=0", () => {
    expect(poissonPmf(0, 0)).toBe(1);
  });

  it("returns 0 for lambda=0, k>0", () => {
    expect(poissonPmf(0, 1)).toBe(0);
    expect(poissonPmf(0, 5)).toBe(0);
  });

  it("returns ~0 for very large k", () => {
    expect(poissonPmf(1.5, 20)).toBeCloseTo(0, 10);
  });
});

describe("poissonCdf", () => {
  it("CDF at large k approaches 1", () => {
    expect(poissonCdf(1.5, 20)).toBeCloseTo(1, 5);
  });

  it("CDF at k=0 equals PMF at k=0", () => {
    expect(poissonCdf(2, 0)).toBeCloseTo(poissonPmf(2, 0), 10);
  });
});

describe("buildScoreMatrix", () => {
  it("sums to approximately 1.0", () => {
    const matrix = buildScoreMatrix(1.5, 1.2);
    let total = 0;
    for (const row of matrix) {
      for (const p of row) {
        total += p;
      }
    }
    expect(total).toBeGreaterThan(0.999);
    expect(total).toBeLessThanOrEqual(1);
  });

  it("has correct dimensions", () => {
    const matrix = buildScoreMatrix(1.5, 1.2, 6);
    expect(matrix.length).toBe(7);
    expect(matrix[0]!.length).toBe(7);
  });
});

describe("outcomeProbabilities", () => {
  it("probabilities sum to 1.0", () => {
    const matrix = buildScoreMatrix(1.5, 1.2);
    const probs = outcomeProbabilities(matrix);
    expect(probs.home + probs.draw + probs.away).toBeCloseTo(1, 5);
  });

  it("equal lambdas produce roughly symmetric home/away", () => {
    const matrix = buildScoreMatrix(1.5, 1.5);
    const probs = outcomeProbabilities(matrix);
    expect(Math.abs(probs.home - probs.away)).toBeLessThan(0.01);
  });

  it("higher home lambda produces higher home win probability", () => {
    const matrix = buildScoreMatrix(2.5, 0.8);
    const probs = outcomeProbabilities(matrix);
    expect(probs.home).toBeGreaterThan(probs.away);
    expect(probs.home).toBeGreaterThan(probs.draw);
  });
});

describe("dixonColesAdjustment", () => {
  it("returns 1.0 when rho is 0", () => {
    expect(dixonColesAdjustment(0, 0, 1.5, 1.2, 0)).toBe(1);
    expect(dixonColesAdjustment(1, 1, 1.5, 1.2, 0)).toBe(1);
    expect(dixonColesAdjustment(2, 1, 1.5, 1.2, 0)).toBe(1);
  });

  it("negative rho increases 0-0 probability", () => {
    const adj = dixonColesAdjustment(0, 0, 1.5, 1.2, -0.05);
    expect(adj).toBeGreaterThan(1);
  });

  it("returns 1 for scorelines above 1-1", () => {
    expect(dixonColesAdjustment(2, 1, 1.5, 1.2, -0.05)).toBe(1);
    expect(dixonColesAdjustment(3, 2, 1.5, 1.2, -0.05)).toBe(1);
  });
});
