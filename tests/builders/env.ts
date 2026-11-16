import { vi } from "vitest";

export const VALID_RATE_LIMIT_SECRET = "0123456789abcdef".repeat(4);

export const VALID_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-of-at-least-twenty-characters",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-of-at-least-twenty-characters",
  RATE_LIMIT_SECRET: VALID_RATE_LIMIT_SECRET,
  NODE_ENV: "test",
} as const;

/** Raw environment as `parseEnv` receives it; `undefined` in `overrides` removes a variable. */
export function rawEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { ...VALID_ENV, ...overrides };
}

/** Stubs `process.env` with a valid configuration (undo with `vi.unstubAllEnvs()`). */
export function stubValidEnv(overrides: Record<string, string | undefined> = {}): void {
  for (const [name, value] of Object.entries(rawEnv(overrides))) {
    if (value !== undefined) {
      vi.stubEnv(name, value);
    }
  }
}
