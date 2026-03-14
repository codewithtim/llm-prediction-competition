import { z } from "zod";

export const monteCarloConfigSchema = z.object({
  simulations: z.number().int().min(1000).max(100_000).default(10_000),
  rho: z.number().min(-0.3).max(0.3).default(-0.04),
  kellyFraction: z.number().min(0).max(1).default(0.25),
  minEdge: z.number().min(0).max(0.5).default(0.03),
  maxBetPct: z.number().min(0).max(1).default(0.05),
  minBetPct: z.number().min(0).max(1).default(0.005),
});

export type MonteCarloConfig = z.infer<typeof monteCarloConfigSchema>;

export const DEFAULT_MC_CONFIG: MonteCarloConfig = {
  simulations: 10_000,
  rho: -0.04,
  kellyFraction: 0.25,
  minEdge: 0.03,
  maxBetPct: 0.05,
  minBetPct: 0.005,
};
