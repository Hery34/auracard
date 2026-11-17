import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rawEnv, stubValidEnv, VALID_ENV } from "../../../tests/builders/env";

// The module is loaded lazily and re-evaluated for each test so that `env` (module-level or lazy)
// is observed under the stubbed `process.env` of that test only.
async function loadEnvModule(): Promise<typeof import("@/server/infrastructure/env")> {
  vi.resetModules();
  return import("@/server/infrastructure/env");
}

beforeEach(() => {
  stubValidEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseEnv", () => {
  it("criterion 2: valid variables → typed object with the five expected keys", async () => {
    const { parseEnv } = await loadEnvModule();

    const env = parseEnv(rawEnv());

    expect(env).toMatchObject({
      NEXT_PUBLIC_SUPABASE_URL: VALID_ENV.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: VALID_ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: VALID_ENV.SUPABASE_SERVICE_ROLE_KEY,
      RATE_LIMIT_SECRET: VALID_ENV.RATE_LIMIT_SECRET,
      NODE_ENV: "test",
    });
  });

  it("ignores unrelated variables of the raw environment", async () => {
    const { parseEnv } = await loadEnvModule();

    const env = parseEnv(rawEnv({ PATH: "/usr/bin", HOME: "/home/carnet" }));

    expect(env).not.toHaveProperty("PATH");
    expect(env).not.toHaveProperty("HOME");
  });

  it.each([
    ["NEXT_PUBLIC_SUPABASE_URL absent", { NEXT_PUBLIC_SUPABASE_URL: undefined }],
    ["NEXT_PUBLIC_SUPABASE_URL not a URL", { NEXT_PUBLIC_SUPABASE_URL: "not-a-url" }],
    ["NEXT_PUBLIC_SUPABASE_URL empty", { NEXT_PUBLIC_SUPABASE_URL: "" }],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY absent", { NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined }],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY of 19 characters", { NEXT_PUBLIC_SUPABASE_ANON_KEY: "a".repeat(19) }],
    ["SUPABASE_SERVICE_ROLE_KEY absent", { SUPABASE_SERVICE_ROLE_KEY: undefined }],
    ["SUPABASE_SERVICE_ROLE_KEY of 19 characters", { SUPABASE_SERVICE_ROLE_KEY: "a".repeat(19) }],
    ["RATE_LIMIT_SECRET absent", { RATE_LIMIT_SECRET: undefined }],
    ["RATE_LIMIT_SECRET of 63 hex characters", { RATE_LIMIT_SECRET: "0".repeat(63) }],
    ["RATE_LIMIT_SECRET of 65 hex characters", { RATE_LIMIT_SECRET: "0".repeat(65) }],
    ["RATE_LIMIT_SECRET of 64 non-hex characters", { RATE_LIMIT_SECRET: "g".repeat(64) }],
    ["RATE_LIMIT_SECRET of 64 uppercase hex characters", { RATE_LIMIT_SECRET: "A".repeat(64) }],
  ])("criterion 2: throws when %s", async (_label, overrides) => {
    const { parseEnv } = await loadEnvModule();

    expect(() => parseEnv(rawEnv(overrides))).toThrow();
  });

  it("accepts the 20-character minimum for the keys and a 64-character lowercase hex secret", async () => {
    const { parseEnv } = await loadEnvModule();

    const env = parseEnv(
      rawEnv({
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "a".repeat(20),
        SUPABASE_SERVICE_ROLE_KEY: "b".repeat(20),
        RATE_LIMIT_SECRET: "f".repeat(64),
      }),
    );

    expect(env.RATE_LIMIT_SECRET).toBe("f".repeat(64));
  });

  it("reads its argument only, never process.env (valid process.env, invalid argument → throws)", async () => {
    const { parseEnv } = await loadEnvModule();

    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe(VALID_ENV.NEXT_PUBLIC_SUPABASE_URL);
    expect(() => parseEnv({})).toThrow();
    expect(() => parseEnv(rawEnv({ NEXT_PUBLIC_SUPABASE_URL: "not-a-url" }))).toThrow();
  });
});

describe("envSchema", () => {
  it("is the Zod schema behind parseEnv", async () => {
    const { envSchema } = await loadEnvModule();

    expect(envSchema.safeParse(rawEnv()).success).toBe(true);
    expect(envSchema.safeParse(rawEnv({ NEXT_PUBLIC_SUPABASE_URL: "not-a-url" })).success).toBe(false);
  });
});

describe("env (loaded from process.env)", () => {
  it("criterion 2: exposes the validated values when process.env is valid", async () => {
    const { env } = await loadEnvModule();

    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(VALID_ENV.NEXT_PUBLIC_SUPABASE_URL);
    expect(env.RATE_LIMIT_SECRET).toBe(VALID_ENV.RATE_LIMIT_SECRET);
  });

  it.each([
    ["absent", undefined],
    ["not a URL", "not-a-url"],
  ])("criterion 2: fails loudly at load time when NEXT_PUBLIC_SUPABASE_URL is %s", async (_label, value) => {
    stubValidEnv();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", value);

    // A loud failure names the offending variable (a Zod issue path or a custom message).
    await expect(loadEnvModule().then((module) => module.env.NEXT_PUBLIC_SUPABASE_URL)).rejects.toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });
});

describe("NEXT_PUBLIC_SUPABASE_URL is a bare origin (0021, decision 12: the media origin of safeImageSrc)", () => {
  it.each([
    ["a path", "https://h.example/supabase"],
    ["a path with a trailing slash", "https://h.example/supabase/"],
    ["a query", "https://h.example/?x=1"],
    ["a fragment", "https://h.example/#x"],
    ["credentials", "https://user:pw@h.example"],
  ])("with %s (%s) → refused, naming the variable", async (_label, value) => {
    const { parseEnv } = await loadEnvModule();

    expect(() => parseEnv(rawEnv({ NEXT_PUBLIC_SUPABASE_URL: value }))).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it.each([
    ["the local stack", "http://127.0.0.1:54321"],
    ["an https origin", "https://h.example"],
    ["an https origin with a trailing slash", "https://h.example/"],
  ])("%s (%s) → accepted", async (_label, value) => {
    const { parseEnv } = await loadEnvModule();

    expect(() => parseEnv(rawEnv({ NEXT_PUBLIC_SUPABASE_URL: value }))).not.toThrow();
  });
});
