import { vi } from "vitest";

export const VALID_RATE_LIMIT_SECRET = "0123456789abcdef".repeat(4);

/** Cloudflare Turnstile test keys (ADR 0008, 0032 decision 6): visible widget that always passes / secret that always accepts. */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
export const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";
/** Secret that always refuses the token (0032, refusal scenarios). */
export const TURNSTILE_REFUSING_SECRET_KEY = "2x0000000000000000000000000000000AA";

/** Fictional keys shaped like Cloudflare's production ones (0x…), for a public production SITE_URL (0032, decision 14). */
export const PRODUCTION_LIKE_TURNSTILE_KEYS = {
  TURNSTILE_SITE_KEY: "0x4AAAAAAAFicTiOnAlSiTe",
  TURNSTILE_SECRET_KEY: "0x4AAAAAAAFicTiOnAlSeCrEtKeY0000000",
} as const;

export const VALID_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-of-at-least-twenty-characters",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-of-at-least-twenty-characters",
  RATE_LIMIT_SECRET: VALID_RATE_LIMIT_SECRET,
  TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY,
  TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY,
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
