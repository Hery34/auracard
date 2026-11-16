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

/** Set by the CI `e2e` job only: the application is reached through the TLS proxy (`.github/e2e.Caddyfile`). */
const baseURL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: !!process.env.CI,
  ...(baseURL ? { use: { baseURL, ignoreHTTPSErrors: true } } : {}),
  // The teardown deletes the e2e-* accounts through the admin client: CI has no Supabase stack yet (CI task).
  ...(process.env.CI ? {} : { globalTeardown: "tests/e2e/global-teardown.ts" }),
  projects: [
    { name: "ios-webkit", use: { ...devices["iPhone 15"] } },
    { name: "android-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm start",
    ...(baseURL ? { url: baseURL, ignoreHTTPSErrors: true } : { port: 3000 }),
    reuseExistingServer: !process.env.CI,
    env: webServerEnv(),
  },
});
