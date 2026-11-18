import { defineConfig, devices } from "@playwright/test";

import ensureSupabaseEnv, { ALLOW_REMOTE_VARIABLE, assertLocalSupabaseUrl } from "./tests/integration/setup/supabase-env";

const SUPABASE_VARIABLES = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

/**
 * Variables handed to `pnpm start`: the E2E always run against the local Supabase stack.
 * When none is exported, the running local stack provides them (`supabase status -o env`) with a
 * rate-limit secret for the run. When `NEXT_PUBLIC_SUPABASE_URL` is exported, it must target the local
 * stack (same guard and same `CARNET_INTEGRATION_ALLOW_REMOTE=1` escape as the integration suite) and
 * the environment is handed as is. Caution: `next start` also loads `.env*` files for any variable
 * left unset here.
 */
function webServerEnv(): Record<string, string> {
  const presetUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (presetUrl) {
    assertLocalSupabaseUrl(presetUrl, process.env[ALLOW_REMOTE_VARIABLE] === "1");
    return {};
  }
  ensureSupabaseEnv();
  const values: Record<string, string> = { RATE_LIMIT_SECRET: "0".repeat(64) };
  for (const name of SUPABASE_VARIABLES) {
    values[name] = process.env[name] ?? "";
  }
  return values;
}

/**
 * Set by the CI `e2e` job only: the application is reached through the TLS proxy (`.github/e2e.Caddyfile`),
 * whose certificate comes from Caddy's local CA. Certificate errors are ignored for a loopback host only.
 */
function e2eBaseUrl(): string | undefined {
  const value = process.env.E2E_BASE_URL;
  if (!value) return undefined;
  const { hostname } = new URL(value);
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(`E2E_BASE_URL must target localhost or 127.0.0.1 (got host "${hostname}")`);
  }
  return value;
}

const baseURL = e2eBaseUrl();

/**
 * `pnpm start` runs in production, where `env.ts` requires an `https://` SITE_URL, except over `http://` on
 * `localhost` or `127.0.0.1` (local run without TLS proxy). It is the origin `/api/beacon` compares `Origin` with
 * (0029, point 10), so it must match the origin the browser loads.
 */
const siteUrl = process.env.SITE_URL ?? (baseURL ? new URL(baseURL).origin : "http://localhost:3000");

/**
 * Cloudflare Turnstile test keys (0032, decision 6), never the production ones: visible widget that always passes,
 * secret that always accepts. The second server shares the build and refuses every token (refusal scenarios).
 */
const TURNSTILE_TEST_KEYS = {
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
};
const TURNSTILE_REFUSING_SECRET_KEY = "2x0000000000000000000000000000000AA";
const REFUSING_PORT = 3001;

export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: !!process.env.CI,
  use: baseURL ? { baseURL, ignoreHTTPSErrors: true } : { baseURL: "http://localhost:3000" },
  // The teardown deletes the e2e-* accounts through the admin client: useless in CI, the stack is discarded with the job.
  ...(process.env.CI ? {} : { globalTeardown: "tests/e2e/global-teardown.ts" }),
  projects: [
    { name: "ios-webkit", use: { ...devices["iPhone 15"] } },
    { name: "android-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "pnpm start",
      ...(baseURL ? { url: baseURL, ignoreHTTPSErrors: true } : { port: 3000 }),
      reuseExistingServer: !process.env.CI,
      env: { ...webServerEnv(), ...TURNSTILE_TEST_KEYS, SITE_URL: siteUrl },
    },
    {
      command: "pnpm start",
      port: REFUSING_PORT,
      reuseExistingServer: false,
      env: {
        ...webServerEnv(),
        ...TURNSTILE_TEST_KEYS,
        TURNSTILE_SECRET_KEY: TURNSTILE_REFUSING_SECRET_KEY,
        PORT: String(REFUSING_PORT),
        SITE_URL: `http://localhost:${REFUSING_PORT}`,
      },
    },
  ],
});
