import "server-only";

import { z } from "zod";

export const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  RATE_LIMIT_SECRET: z.string().regex(/^[0-9a-f]{64}$/, "expected 64 lowercase hex characters (openssl rand -hex 32)"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Pure: reads its argument only. The error names the offending variables, never their values.
 * `Partial`: Next.js declares `NODE_ENV` as required on `ProcessEnv`, and a partial environment is a valid input.
 */
export function parseEnv(raw: Partial<NodeJS.ProcessEnv>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment variables:\n${issues.join("\n")}`);
  }
  return parsed.data;
}

export const env: Env = parseEnv(process.env);
