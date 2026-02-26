import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  POLY_PRIVATE_KEY: z.string().min(1),
  POLY_API_KEY: z.string().min(1),
  POLY_API_SECRET: z.string().min(1),
  POLY_API_PASSPHRASE: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  API_SPORTS_KEY: z.string().min(1),
  TURSO_DATABASE_URL: z.url(),
  TURSO_AUTH_TOKEN: z.string().min(1),
});

export const env = envSchema.parse(process.env);
