import { z } from "zod";

export const predictionOutputSchema = z.object({
  marketId: z.string(),
  side: z.enum(["YES", "NO"]),
  confidence: z.number().min(0).max(1),
  stake: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(500),
});

export type PredictionOutput = z.infer<typeof predictionOutputSchema>;
