import { describe, expect, it } from "bun:test";
import { validateStake } from "../../../../src/competitors/weight-tuned/stake-validator";
import {
  DEFAULT_STAKE_CONFIG,
  DEFAULT_WEIGHTS,
  type StakeConfig,
} from "../../../../src/competitors/weight-tuned/types";
import { validateWeights } from "../../../../src/competitors/weight-tuned/validator";

describe("validateWeights", () => {
  it("accepts valid DEFAULT_WEIGHTS", () => {
    const result = validateWeights(DEFAULT_WEIGHTS, DEFAULT_STAKE_CONFIG);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.weights).toEqual(DEFAULT_WEIGHTS);
    }
  });

  it("accepts valid custom weights", () => {
    const weights = {
      signals: {
        homeWinRate: 0.5,
        formDiff: 0.2,
        h2h: 0.1,
        goalDiff: 0.2,
      },
      drawBaseline: 0.2,
      drawPeak: 0.45,
      drawWidth: 0.12,
      confidenceThreshold: 0.55,
      minEdge: 0.03,
      stakingAggression: 0.4,
      edgeMultiplier: 1.5,
      kellyFraction: 0.2,
    };
    const result = validateWeights(weights, DEFAULT_STAKE_CONFIG);
    expect(result.valid).toBe(true);
  });

  it("rejects signal weight out of range (> 1)", () => {
    const weights = {
      ...DEFAULT_WEIGHTS,
      signals: { ...DEFAULT_WEIGHTS.signals, homeWinRate: 1.5 },
    };
    const result = validateWeights(weights, DEFAULT_STAKE_CONFIG);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("Schema validation failed");
    }
  });

  it("rejects signal weight out of range (< 0)", () => {
    const weights = {
      ...DEFAULT_WEIGHTS,
      signals: { ...DEFAULT_WEIGHTS.signals, homeWinRate: -0.1 },
    };
    const result = validateWeights(weights, DEFAULT_STAKE_CONFIG);
    expect(result.valid).toBe(false);
  });

  it("rejects drawBaseline out of range", () => {
    const weights = { ...DEFAULT_WEIGHTS, drawBaseline: 0.8 };
    const result = validateWeights(weights, DEFAULT_STAKE_CONFIG);
    expect(result.valid).toBe(false);
  });

  it("rejects missing required fields", () => {
    const incomplete = {
      signals: { homeWinRate: 0.4 },
      drawBaseline: 0.25,
      // missing other fields
    };
    const result = validateWeights(incomplete, DEFAULT_STAKE_CONFIG);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("Schema validation failed");
    }
  });

  it("rejects non-object input", () => {
    const result = validateWeights("not an object", DEFAULT_STAKE_CONFIG);
    expect(result.valid).toBe(false);
  });

  it("rejects null input", () => {
    const result = validateWeights(null, DEFAULT_STAKE_CONFIG);
    expect(result.valid).toBe(false);
  });

  it("rejects edgeMultiplier out of range", () => {
    const weights = { ...DEFAULT_WEIGHTS, edgeMultiplier: 10 };
    const result = validateWeights(weights, DEFAULT_STAKE_CONFIG);
    expect(result.valid).toBe(false);
  });
});

describe("validateStake", () => {
  const stakeConfig: StakeConfig = {
    maxBetPct: 0.05,
    minBet: 1,
    bankroll: 100,
  };

  it("accepts valid stake within bounds", () => {
    const result = validateStake(
      { marketId: "m1", side: "YES", confidence: 0.7, stake: 3, reasoning: "test" },
      100,
      stakeConfig,
    );
    expect(result.valid).toBe(true);
  });

  it("rejects zero stake", () => {
    const result = validateStake(
      { marketId: "m1", side: "YES", confidence: 0.7, stake: 0, reasoning: "test" },
      100,
      stakeConfig,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("positive");
  });

  it("rejects negative stake", () => {
    const result = validateStake(
      { marketId: "m1", side: "YES", confidence: 0.7, stake: -5, reasoning: "test" },
      100,
      stakeConfig,
    );
    expect(result.valid).toBe(false);
  });

  it("rejects stake below minimum", () => {
    const result = validateStake(
      { marketId: "m1", side: "YES", confidence: 0.7, stake: 0.5, reasoning: "test" },
      100,
      stakeConfig,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("minimum");
  });

  it("rejects stake exceeding max bet percentage", () => {
    const result = validateStake(
      { marketId: "m1", side: "YES", confidence: 0.7, stake: 10, reasoning: "test" },
      100,
      stakeConfig,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("max bet");
  });

  it("rejects stake exceeding bankroll", () => {
    const result = validateStake(
      { marketId: "m1", side: "YES", confidence: 0.7, stake: 150, reasoning: "test" },
      100,
      stakeConfig,
    );
    expect(result.valid).toBe(false);
  });

  it("accepts stake at exact maximum", () => {
    const result = validateStake(
      { marketId: "m1", side: "YES", confidence: 0.7, stake: 5, reasoning: "test" },
      100,
      stakeConfig,
    );
    expect(result.valid).toBe(true);
  });

  it("accepts stake at exact minimum", () => {
    const result = validateStake(
      { marketId: "m1", side: "YES", confidence: 0.7, stake: 1, reasoning: "test" },
      100,
      stakeConfig,
    );
    expect(result.valid).toBe(true);
  });
});
