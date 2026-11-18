import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRODUCTION_LIKE_TURNSTILE_KEYS, rawEnv, stubValidEnv } from "../../../tests/builders/env";

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

describe("SITE_URL (0019)", () => {
  it.each([
    ["https://carnet.example", "https://carnet.example"],
    ["https://carnet.example/", "https://carnet.example"],
    ["https://Carnet.Example:8443", "https://carnet.example:8443"],
    ["https://carnet.example/?", "https://carnet.example"],
    ["https://carnet.example/#", "https://carnet.example"],
  ])("production: %s → origin %s", async (value, expected) => {
    const { parseEnv } = await loadEnvModule();

    expect(parseEnv(rawEnv({ NODE_ENV: "production", SITE_URL: value, ...PRODUCTION_LIKE_TURNSTILE_KEYS })).SITE_URL).toBe(expected);
  });

  it.each([
    ["absent", undefined],
    ["http", "http://carnet.example"],
  ])("production: throws when SITE_URL is %s, naming the variable", async (_label, value) => {
    const { parseEnv } = await loadEnvModule();

    expect(() => parseEnv(rawEnv({ NODE_ENV: "production", SITE_URL: value }))).toThrow(/SITE_URL/);
  });

  it.each([
    ["http://localhost:3000", "http://localhost:3000"],
    ["http://127.0.0.1:3000", "http://127.0.0.1:3000"],
  ])("production, local E2E origin (0029): %s accepted → origin %s", async (value, expected) => {
    const { parseEnv } = await loadEnvModule();

    expect(parseEnv(rawEnv({ NODE_ENV: "production", SITE_URL: value })).SITE_URL).toBe(expected);
  });

  it.each([
    "http://carnet.example",
    "http://localhost.evil.example",
    "http://evil-localhost:3000",
    "http://127.0.0.1.evil.example",
    "http://192.168.1.10",
    "http://0.0.0.0:3000",
    "http://[::1]:3000",
  ])("production, local E2E origin (0029): http with another host %s still refused", async (value) => {
    const { parseEnv } = await loadEnvModule();

    expect(() => parseEnv(rawEnv({ NODE_ENV: "production", SITE_URL: value }))).toThrow(/SITE_URL/);
    expect(() => parseEnv(rawEnv({ NODE_ENV: "production", SITE_URL: value }))).toThrow(
      /https:\/\/ required in production/,
    );
  });

  it.each([
    ["a path", "https://carnet.example/app"],
    ["a query", "https://carnet.example/?a=1"],
    ["a fragment", "https://carnet.example/#top"],
    ["credentials", "https://user:pass@carnet.example"],
    ["another scheme", "ftp://carnet.example"],
    ["not a URL", "carnet.example"],
  ])("throws when SITE_URL has %s, whatever NODE_ENV", async (_label, value) => {
    const { parseEnv } = await loadEnvModule();

    expect(() => parseEnv(rawEnv({ NODE_ENV: "development", SITE_URL: value }))).toThrow(/SITE_URL/);
    expect(() => parseEnv(rawEnv({ NODE_ENV: "production", SITE_URL: value }))).toThrow(/SITE_URL/);
  });

  it("outside production: http://localhost:3000 accepted, and the default when absent", async () => {
    const { parseEnv } = await loadEnvModule();

    expect(parseEnv(rawEnv({ NODE_ENV: "development", SITE_URL: "http://localhost:3000/" })).SITE_URL).toBe(
      "http://localhost:3000",
    );
    expect(parseEnv(rawEnv({ NODE_ENV: "test", SITE_URL: undefined })).SITE_URL).toBe("http://localhost:3000");
  });
});
