import { z } from "zod";

export const weightConfigSchema = z.object({
  signals: z.record(z.string(), z.number().min(0).max(1)),
  drawBaseline: z.number().min(0).max(0.5),
  drawPeak: z.number().min(0.3).max(0.7),
  drawWidth: z.number().min(0.05).max(0.5),
  confidenceThreshold: z.number().min(0).max(1),
  minEdge: z.number().min(0).max(0.5),
  stakingAggression: z.number().min(0).max(1),
  edgeMultiplier: z.number().min(0).max(5),
  kellyFraction: z.number().min(0).max(1),
});

export type WeightConfig = z.infer<typeof weightConfigSchema>;

export const DEFAULT_WEIGHTS: WeightConfig = {
  signals: {
    homeWinRate: 0.4,
    formDiff: 0.3,
    h2h: 0.3,
    awayLossRate: 0.0,
    goalDiff: 0.0,
    pointsPerGame: 0.0,
    defensiveStrength: 0.0,
    injuryImpact: 0.0,
    cleanSheetDiff: 0.0,
    scoringConsistency: 0.0,
  },
  drawBaseline: 0.25,
  drawPeak: 0.5,
  drawWidth: 0.15,
  confidenceThreshold: 0.52,
  minEdge: 0.05,
  stakingAggression: 0.5,
  edgeMultiplier: 2.0,
  kellyFraction: 0.25,
};

export const stakeConfigSchema = z.object({
  maxBetPct: z.number().min(0).max(1),
  minBetPct: z.number().min(0).max(1),
});

export type StakeConfig = z.infer<typeof stakeConfigSchema>;

export const DEFAULT_STAKE_CONFIG: StakeConfig = {
  maxBetPct: 0.05,
  minBetPct: 0.005,
};

export const WEIGHT_JSON_SCHEMA = {
  name: "weight_config",
  schema: {
    type: "object",
    properties: {
      signals: {
        type: "object",
        description:
          "Feature signal weights (0-1). Keys: homeWinRate, awayLossRate, formDiff, h2h, goalDiff, pointsPerGame, defensiveStrength, injuryImpact, cleanSheetDiff, scoringConsistency",
        additionalProperties: { type: "number" },
      },
      drawBaseline: {
        type: "number",
        description: "Base draw probability (0-0.5)",
      },
      drawPeak: {
        type: "number",
        description: "Home strength value where draw is most likely (0.3-0.7)",
      },
      drawWidth: {
        type: "number",
        description: "Width of the draw probability curve (0.05-0.5)",
      },
      confidenceThreshold: {
        type: "number",
        description: "Minimum confidence to bet aggressively (0-1)",
      },
      minEdge: {
        type: "number",
        description: "Minimum edge over market price to consider (0-0.5)",
      },
      stakingAggression: {
        type: "number",
        description: "Base staking level (0-1)",
      },
      edgeMultiplier: {
        type: "number",
        description: "How much edge amplifies stake (0-5)",
      },
      kellyFraction: {
        type: "number",
        description: "Fraction of Kelly criterion to use (0-1)",
      },
    },
    required: [
      "signals",
      "drawBaseline",
      "drawPeak",
      "drawWidth",
      "confidenceThreshold",
      "minEdge",
      "stakingAggression",
      "edgeMultiplier",
      "kellyFraction",
    ],
    additionalProperties: false,
  },
} as const;
