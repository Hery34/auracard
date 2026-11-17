/**
 * Contract frozen by test-engineer (0026, decision 8; criterion 6).
 *
 * // src/server/infrastructure/env.ts — Env gains QR_PRINT_READY: boolean.
 * //   Exactly "true" → true; absent or any other value ("false", "1", "TRUE", "yes", "") → false. Never throws,
 * //   in production as elsewhere. While false, /tableau-de-bord/qr shows « Domaine provisoire : n'imprimez pas ce QR code. »
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rawEnv, stubValidEnv } from "../../../tests/builders/env";

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

describe("QR_PRINT_READY (0026, decision 8)", () => {
  it("criterion 6: absent → false (the provisional-domain warning is shown)", async () => {
    const { parseEnv } = await loadEnvModule();

    expect(parseEnv(rawEnv({ QR_PRINT_READY: undefined })).QR_PRINT_READY).toBe(false);
  });

  it("criterion 6: exactly 'true' → true (no warning)", async () => {
    const { parseEnv } = await loadEnvModule();

    expect(parseEnv(rawEnv({ QR_PRINT_READY: "true" })).QR_PRINT_READY).toBe(true);
  });

  it.each(["false", "1", "TRUE", "True", "yes", "on", "", " true", "true "])("%j → false, without throwing", async (value) => {
    const { parseEnv } = await loadEnvModule();

    expect(parseEnv(rawEnv({ QR_PRINT_READY: value })).QR_PRINT_READY).toBe(false);
  });

  it("production: absent is valid (false), 'true' is valid (true)", async () => {
    const { parseEnv } = await loadEnvModule();
    const production = { NODE_ENV: "production", SITE_URL: "https://carnet.example" };

    expect(parseEnv(rawEnv({ ...production, QR_PRINT_READY: undefined })).QR_PRINT_READY).toBe(false);
    expect(parseEnv(rawEnv({ ...production, QR_PRINT_READY: "true" })).QR_PRINT_READY).toBe(true);
  });

  it("env (loaded from process.env) exposes the boolean", async () => {
    stubValidEnv({ QR_PRINT_READY: "true" });

    expect((await loadEnvModule()).env.QR_PRINT_READY).toBe(true);
  });

  it("env without the variable → false", async () => {
    vi.unstubAllEnvs();
    stubValidEnv();
    vi.stubEnv("QR_PRINT_READY", undefined);

    expect((await loadEnvModule()).env.QR_PRINT_READY).toBe(false);
  });
});
