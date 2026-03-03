import { describe, expect, it } from "bun:test";
import {
  DEFAULT_STAKE_CONFIG,
  DEFAULT_WEIGHTS,
} from "../../../../src/competitors/weight-tuned/types";
import { validateWeights } from "../../../../src/competitors/weight-tuned/validator";
import { validateStake } from "../../../../src/domain/services/stake-validator";

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
        awayLossRate: 0,
        pointsPerGame: 0,
        defensiveStrength: 0,
        injuryImpact: 0,
        cleanSheetDiff: 0,
        scoringConsistency: 0,
        winStreakMomentum: 0,
        penaltyReliability: 0,
        lateGoalThreat: 0,
        lateGoalVulnerability: 0,
        overTwoFiveGoals: 0,
        defensiveOverTwoFive: 0,
        squadRating: 0,
        attackingOutput: 0,
        injuredKeyPlayers: 0,
        h2hRecentForm: 0,
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

  it("rejects weights with missing signal coverage", () => {
    const weights = {
      ...DEFAULT_WEIGHTS,
      signals: {
        homeWinRate: 0.4,
        formDiff: 0.3,
        h2h: 0.3,
      },
    };
    const result = validateWeights(weights, DEFAULT_STAKE_CONFIG);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("missing signals");
      expect(result.error).toContain("injuryImpact");
      expect(result.error).toContain("cleanSheetDiff");
      expect(result.error).toContain("scoringConsistency");
    }
  });

  it("rejects edgeMultiplier out of range", () => {
    const weights = { ...DEFAULT_WEIGHTS, edgeMultiplier: 10 };
    const result = validateWeights(weights, DEFAULT_STAKE_CONFIG);
    expect(result.valid).toBe(false);
  });
});

describe("validateStake", () => {
  const constraints = {
    maxBetPctOfBankroll: 0.05,
    minBetAmount: 1,
  };

  it("accepts valid stake within bounds", () => {
    const result = validateStake(3, 100, constraints);
    expect(result.valid).toBe(true);
  });

  it("rejects zero stake", () => {
    const result = validateStake(0, 100, constraints);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("positive");
  });

  it("rejects negative stake", () => {
    const result = validateStake(-5, 100, constraints);
    expect(result.valid).toBe(false);
  });

  it("rejects stake below minimum amount", () => {
    const result = validateStake(0.5, 100, constraints);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("minimum");
  });

  it("rejects stake exceeding max bet percentage of bankroll", () => {
    const result = validateStake(10, 100, constraints);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("5%");
  });

  it("rejects stake exceeding bankroll", () => {
    // maxBetPctOfBankroll > 1 so percentage check doesn't catch it first
    const result = validateStake(150, 100, { maxBetPctOfBankroll: 2, minBetAmount: 1 });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("exceeds bankroll");
  });

  it("accepts stake at exact maximum", () => {
    const result = validateStake(5, 100, constraints);
    expect(result.valid).toBe(true);
  });

  it("accepts stake at exact minimum", () => {
    const result = validateStake(1, 100, constraints);
    expect(result.valid).toBe(true);
  });

  it("rejects all bets when bankroll is below minimum bet threshold", () => {
    const result = validateStake(0.5, 0.5, constraints);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("below minimum bet threshold");
  });

  it("rejects all bets when bankroll is zero", () => {
    const result = validateStake(1, 0, constraints);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("below minimum bet threshold");
  });
});
