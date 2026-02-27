import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  POLY_PRIVATE_KEY: z.string().default(""),
  POLY_API_KEY: z.string().default(""),
  POLY_API_SECRET: z.string().default(""),
  POLY_API_PASSPHRASE: z.string().default(""),
  OPENROUTER_API_KEY: z.string().default(""),
  API_SPORTS_KEY: z.string().min(1),
  TURSO_DATABASE_URL: z.string().min(1),
  TURSO_AUTH_TOKEN: z.string().default(""),
});

export const env = envSchema.parse(process.env);
