import "server-only";

import { z } from "zod";

/** Outside production only: the origin of `next dev`. */
const DEVELOPMENT_SITE_URL = "http://localhost:3000";

/** Hosts allowed over `http://` in production: the local E2E run of `pnpm start`, without TLS proxy (0029). */
const LOCAL_HTTP_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1"]);

/** Public origin (scheme, host, optional port), normalized without trailing slash. */
const originSchema = z
  .url({ protocol: /^https?$/ })
  .refine(isBareOrigin, "expected an origin without path, query, fragment or credentials")
  .transform((value) => new URL(value).origin);

export const envSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: originSchema,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
    RATE_LIMIT_SECRET: z.string().regex(/^[0-9a-f]{64}$/, "expected 64 lowercase hex characters (openssl rand -hex 32)"),
    SITE_URL: originSchema.optional(),
    QR_PRINT_READY: z
      .string()
      .optional()
      .transform((value) => value === "true"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  })
  .superRefine((raw, context) => {
    if (raw.NODE_ENV !== "production") return;
    if (raw.SITE_URL === undefined) {
      context.addIssue({ code: "custom", path: ["SITE_URL"], message: "required in production" });
    } else if (!isProductionSiteUrl(raw.SITE_URL)) {
      context.addIssue({ code: "custom", path: ["SITE_URL"], message: "https:// required in production" });
    }
  })
  .transform((raw) => ({ ...raw, SITE_URL: raw.SITE_URL ?? DEVELOPMENT_SITE_URL }));

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

function isProductionSiteUrl(origin: string): boolean {
  const url = URL.parse(origin);
  return url !== null && (url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HTTP_HOSTS.has(url.hostname)));
}

function isBareOrigin(value: string): boolean {
  const url = URL.parse(value);
  return url !== null && url.pathname === "/" && url.search === "" && url.hash === "" && url.username === "" && url.password === "";
}

export const env: Env = parseEnv(process.env);
