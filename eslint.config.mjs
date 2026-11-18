import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const frameworkImports = ["next", "next/*", "react", "react/*", "react-dom", "react-dom/*"];
const supabaseImports = ["@supabase/*"];
const nodeBuiltins = [
  "crypto",
  "net",
  "fs",
  "path",
  "os",
  "child_process",
  "http",
  "https",
  "url",
  "util",
  "events",
  "stream",
  "buffer",
];
const nodeImports = ["node:*", ...nodeBuiltins];
const outerLayers = ["@/server/**", "@/app/**", "@/ui/**", "**/server/**", "**/app/**", "**/ui/**"];

const domainPurity = {
  group: [...frameworkImports, ...supabaseImports, ...nodeImports, ...outerLayers],
  message: "src/domain is pure TypeScript: no Next.js, React, Supabase, Node.js or outer-layer imports.",
};

// ADR 0012: the presentation layer reaches the server through its actions and the composition root only.
const presentationBoundary = {
  group: [
    ...supabaseImports,
    "@/server/repositories/**",
    "@/server/infrastructure/**",
    "**/server/repositories/**",
    "**/server/infrastructure/**",
  ],
  message: "src/app and src/ui import @/server/actions/* and @/server/container only (ADR 0012).",
};

// ADR 0011: the service_role client is injected by the composition root, never imported by an adapter.
const adminClient = {
  group: [
    "@/server/infrastructure/supabase/admin",
    "**/supabase/admin",
    "**/supabase/admin.js",
    "**/supabase/admin.ts",
    "./admin",
    "./admin.js",
    "./admin.ts",
  ],
  message: "admin.ts (service_role) is imported by src/server/container.ts only.",
};

// ADR 0011: the adapters fed by the service_role client are wired by the composition root only (tests excepted).
const adminAdapters = {
  group: [
    "**/repositories/supabase-profile-registrar",
    "**/repositories/supabase-rate-limiter",
    "**/repositories/supabase-instance-account-remover",
    "**/repositories/supabase-event-recorder",
    "**/repositories/supabase-lead-capturer",
    "./supabase-profile-registrar",
    "./supabase-rate-limiter",
    "./supabase-instance-account-remover",
    "./supabase-event-recorder",
    "./supabase-lead-capturer",
  ],
  message: "Adapters of the service_role client are imported by src/server/container.ts only (ADR 0011).",
};

const testFiles = ["**/*.test.ts", "**/*.spec.ts", "tests/**"];

// Rule options are replaced, not merged, between config objects: every block lists all its patterns.
const restrictImports = (...patterns) => ({
  "no-restricted-imports": ["error", { patterns }],
});

export default defineConfig([
  globalIgnores([".next/", "node_modules/", "playwright-report/", "test-results/", ".remember/"]),
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx,mts,cts}"],
    ignores: ["src/server/container.ts"],
    rules: restrictImports(adminClient),
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx,mts,cts}"],
    ignores: ["src/server/container.ts", ...testFiles],
    rules: restrictImports(adminClient, adminAdapters),
  },
  {
    files: ["src/domain/**"],
    rules: restrictImports(adminClient, domainPurity),
  },
  {
    files: ["src/app/**", "src/ui/**"],
    rules: restrictImports(adminClient, presentationBoundary),
  },
]);
