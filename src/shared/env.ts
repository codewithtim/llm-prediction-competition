import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  OPENROUTER_API_KEY: z.string().default(""),
  API_SPORTS_KEY: z.string().min(1),
  TURSO_DATABASE_URL: z.string().min(1),
  TURSO_AUTH_TOKEN: z.string().default(""),
  WALLET_ENCRYPTION_KEY: z.string().default(""),
  PROXY_URL: z.string().default(""),
});

export const env = envSchema.parse(process.env);
