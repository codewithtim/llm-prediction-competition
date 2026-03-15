import { z } from "zod";
import { FEATURE_NAMES } from "./features";

export const weightConfigSchema = z.object({
  signals: z.record(z.string(), z.number().min(0).max(1)),
  drawBaseline: z.number().min(0).max(0.5),
  drawPeak: z.number().min(0.3).max(0.7),
  drawWidth: z.number().min(0.05).max(0.5),
  sharpness: z.number().min(1).max(5),
  minEdge: z.number().min(0).max(0.5),
  kellyFraction: z.number().min(0).max(1),
  // Legacy fields — kept for backwards compat with existing DB versions, not used by engine
  confidenceThreshold: z.number().min(0).max(1).optional(),
  stakingAggression: z.number().min(0).max(1).optional(),
  edgeMultiplier: z.number().min(0).max(5).optional(),
});

export type WeightConfig = z.infer<typeof weightConfigSchema>;

const ACTIVE_DEFAULTS: Record<string, number> = {
  homeWinRate: 0.4,
  formDiff: 0.3,
  h2h: 0.3,
};

export const DEFAULT_WEIGHTS: WeightConfig = {
  signals: Object.fromEntries(FEATURE_NAMES.map((name) => [name, ACTIVE_DEFAULTS[name] ?? 0.0])),
  drawBaseline: 0.25,
  drawPeak: 0.5,
  drawWidth: 0.15,
  sharpness: 2.5,
  minEdge: 0.05,
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

export const changelogEntrySchema = z.object({
  parameter: z.string(),
  previous: z.number(),
  new: z.number(),
  reason: z.string(),
});

export const weightOutputSchema = z.object({
  weights: weightConfigSchema,
  changelog: z.array(changelogEntrySchema),
  overallAssessment: z.string(),
});

export type WeightOutput = z.infer<typeof weightOutputSchema>;
export type ChangelogEntry = z.infer<typeof changelogEntrySchema>;

export const WEIGHT_JSON_SCHEMA = {
  name: "weight_config",
  schema: {
    type: "object",
    properties: {
      signals: {
        type: "object",
        description: `Feature signal weights (0-1). Keys: ${FEATURE_NAMES.join(", ")}`,
        properties: Object.fromEntries(FEATURE_NAMES.map((name) => [name, { type: "number" }])),
        required: FEATURE_NAMES,
        additionalProperties: false,
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
      sharpness: {
        type: "number",
        description:
          "Power curve exponent for probability split (1-5). Higher values make favourites more dominant. 1.0 = linear, 2.5 = moderate, 4+ = extreme separation",
      },
      minEdge: {
        type: "number",
        description:
          "Minimum edge over market price to place a bet (0-0.5). Bets below this edge are skipped entirely",
      },
      kellyFraction: {
        type: "number",
        description:
          "Fraction of Kelly criterion to use for stake sizing (0-1). 0.25 = quarter Kelly (conservative), 0.5 = half Kelly (moderate), 1.0 = full Kelly (aggressive)",
      },
    },
    required: [
      "signals",
      "drawBaseline",
      "drawPeak",
      "drawWidth",
      "sharpness",
      "minEdge",
      "kellyFraction",
    ],
    additionalProperties: false,
  },
};

export const WEIGHT_OUTPUT_JSON_SCHEMA = {
  name: "weight_output",
  schema: {
    type: "object",
    properties: {
      weights: WEIGHT_JSON_SCHEMA.schema,
      changelog: {
        type: "array",
        description: "List of parameter changes with reasoning",
        items: {
          type: "object",
          properties: {
            parameter: {
              type: "string",
              description: "Dotted path to the parameter (e.g. 'signals.h2h', 'minEdge')",
            },
            previous: { type: "number", description: "Previous value" },
            new: { type: "number", description: "New value" },
            reason: { type: "string", description: "Why you made this change" },
          },
          required: ["parameter", "previous", "new", "reason"],
          additionalProperties: false,
        },
      },
      overallAssessment: {
        type: "string",
        description:
          "Strategic summary of your analysis and the reasoning behind your changes (2-4 sentences)",
      },
    },
    required: ["weights", "changelog", "overallAssessment"],
    additionalProperties: false,
  },
};
