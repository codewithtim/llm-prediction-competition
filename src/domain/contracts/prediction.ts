import { z } from "zod";

export const reasoningSectionSchema = z.object({
  label: z.string(),
  content: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const reasoningSchema = z.object({
  summary: z.string(),
  sections: z.array(reasoningSectionSchema).min(1),
});

export type Reasoning = z.infer<typeof reasoningSchema>;

export const predictionOutputSchema = z.object({
  marketId: z.string(),
  side: z.enum(["YES", "NO"]),
  confidence: z.number().min(0).max(1),
  stake: z.number().min(0).max(1),
  reasoning: reasoningSchema,
});

export type PredictionOutput = z.infer<typeof predictionOutputSchema>;
