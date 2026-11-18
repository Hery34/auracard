/**
 * Contract frozen by test-engineer (0032, decisions 2 and 6; ADR 0008).
 *
 * // src/server/infrastructure/env.ts — Env gains TURNSTILE_SITE_KEY: string and TURNSTILE_SECRET_KEY: string.
 * //   Both required (non-empty after trim), in every environment: without them the contact form cannot work, and a
 * //   silent default would let submissions through or block them all. Development, CI and E2E use the Cloudflare
 * //   test keys (tests/builders/env.ts); never the production keys.
 * // Decision 14: a Cloudflare test key (/^[123]x0+[A-F]{2}$/, site or secret) is refused when NODE_ENV is "production" and
 * //   the hostname of SITE_URL is neither "localhost" nor "127.0.0.1" (the local E2E run of `pnpm start`); accepted
 * //   otherwise. The error names the variable, never its value.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PRODUCTION_LIKE_TURNSTILE_KEYS as PRODUCTION_LIKE_KEYS,
  rawEnv,
  stubValidEnv,
  TURNSTILE_REFUSING_SECRET_KEY,
  TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_TEST_SITE_KEY,
} from "../../../tests/builders/env";

const PUBLIC_SITE_URL = "https://carnet.example";

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

describe("TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY (0032)", () => {
  it("decision 6: both keys are read as given", async () => {
    const { parseEnv } = await loadEnvModule();

    const env = parseEnv(rawEnv());

    expect(env.TURNSTILE_SITE_KEY).toBe(TURNSTILE_TEST_SITE_KEY);
    expect(env.TURNSTILE_SECRET_KEY).toBe(TURNSTILE_TEST_SECRET_KEY);
  });

  it.each([
    ["TURNSTILE_SITE_KEY absent", { TURNSTILE_SITE_KEY: undefined }],
    ["TURNSTILE_SITE_KEY empty", { TURNSTILE_SITE_KEY: "" }],
    ["TURNSTILE_SITE_KEY blank", { TURNSTILE_SITE_KEY: "   " }],
    ["TURNSTILE_SECRET_KEY absent", { TURNSTILE_SECRET_KEY: undefined }],
    ["TURNSTILE_SECRET_KEY empty", { TURNSTILE_SECRET_KEY: "" }],
    ["TURNSTILE_SECRET_KEY blank", { TURNSTILE_SECRET_KEY: "   " }],
  ])("throws when %s", async (_label, overrides) => {
    const { parseEnv } = await loadEnvModule();

    expect(() => parseEnv(rawEnv(overrides))).toThrow(/TURNSTILE_/);
  });

  it("required in production too", async () => {
    const { parseEnv } = await loadEnvModule();

    expect(() =>
      parseEnv(rawEnv({ NODE_ENV: "production", SITE_URL: "https://auracard.fr", TURNSTILE_SECRET_KEY: undefined })),
    ).toThrow(/TURNSTILE_SECRET_KEY/);
  });
});

describe("decision 14: Cloudflare test keys never in a public production", () => {
  it.each([
    ["site key « always passes »", "TURNSTILE_SITE_KEY", TURNSTILE_TEST_SITE_KEY],
    ["site key « always blocks »", "TURNSTILE_SITE_KEY", "2x00000000000000000000AA"],
    ["site key « forces an interactive challenge »", "TURNSTILE_SITE_KEY", "3x00000000000000000000AA"],
    ["invisible site key « always passes »", "TURNSTILE_SITE_KEY", "1x00000000000000000000BB"],
    ["invisible site key « always blocks »", "TURNSTILE_SITE_KEY", "2x00000000000000000000AB"],
    ["site key « forces an interactive challenge » (FF)", "TURNSTILE_SITE_KEY", "3x00000000000000000000FF"],
    ["secret « always passes »", "TURNSTILE_SECRET_KEY", TURNSTILE_TEST_SECRET_KEY],
    ["secret « always fails »", "TURNSTILE_SECRET_KEY", TURNSTILE_REFUSING_SECRET_KEY],
    ["secret « token already spent »", "TURNSTILE_SECRET_KEY", "3x0000000000000000000000000000000AA"],
  ])("production on a public SITE_URL: %s refused, named without its value", async (_label, variable, key) => {
    const { parseEnv } = await loadEnvModule();
    const raw = rawEnv({ NODE_ENV: "production", SITE_URL: PUBLIC_SITE_URL, ...PRODUCTION_LIKE_KEYS, [variable]: key });

    expect(() => parseEnv(raw)).toThrow(new RegExp(variable));
    expect(() => parseEnv(raw)).not.toThrow(key);
  });

  it("production on a public SITE_URL with production-like keys → accepted", async () => {
    const { parseEnv } = await loadEnvModule();

    const env = parseEnv(rawEnv({ NODE_ENV: "production", SITE_URL: PUBLIC_SITE_URL, ...PRODUCTION_LIKE_KEYS }));

    expect(env.TURNSTILE_SITE_KEY).toBe(PRODUCTION_LIKE_KEYS.TURNSTILE_SITE_KEY);
    expect(env.TURNSTILE_SECRET_KEY).toBe(PRODUCTION_LIKE_KEYS.TURNSTILE_SECRET_KEY);
  });

  it.each([
    ["http://localhost:3000"],
    ["http://localhost:3001"],
    ["http://127.0.0.1:3000"],
  ])("production on %s (local E2E run of pnpm start) → test keys accepted", async (siteUrl) => {
    const { parseEnv } = await loadEnvModule();

    const env = parseEnv(rawEnv({ NODE_ENV: "production", SITE_URL: siteUrl, TURNSTILE_SECRET_KEY: TURNSTILE_REFUSING_SECRET_KEY }));

    expect(env.TURNSTILE_SITE_KEY).toBe(TURNSTILE_TEST_SITE_KEY);
    expect(env.TURNSTILE_SECRET_KEY).toBe(TURNSTILE_REFUSING_SECRET_KEY);
  });

  it.each([
    ["1x00000000000000000000BB"],
    ["2x00000000000000000000AB"],
    ["3x00000000000000000000FF"],
  ])("production on localhost: site key %s accepted", async (key) => {
    const { parseEnv } = await loadEnvModule();

    const env = parseEnv(rawEnv({ NODE_ENV: "production", SITE_URL: "http://localhost:3000", TURNSTILE_SITE_KEY: key }));

    expect(env.TURNSTILE_SITE_KEY).toBe(key);
  });

  it("production on a public SITE_URL: real-format site key 0x4AAAAAAA… accepted", async () => {
    const { parseEnv } = await loadEnvModule();
    const key = "0x4AAAAAAAB1cDeFgHiJkLmN";

    const env = parseEnv(rawEnv({ NODE_ENV: "production", SITE_URL: PUBLIC_SITE_URL, ...PRODUCTION_LIKE_KEYS, TURNSTILE_SITE_KEY: key }));

    expect(env.TURNSTILE_SITE_KEY).toBe(key);
  });

  it.each([["development"], ["test"]])("NODE_ENV %s, even with a public SITE_URL → test keys accepted", async (nodeEnv) => {
    const { parseEnv } = await loadEnvModule();

    expect(parseEnv(rawEnv({ NODE_ENV: nodeEnv, SITE_URL: PUBLIC_SITE_URL })).TURNSTILE_SECRET_KEY).toBe(TURNSTILE_TEST_SECRET_KEY);
  });
});
