import { afterAll, describe, expect, it, vi } from "vitest";

import { stubValidEnv } from "../../tests/builders/env";

vi.mock("next/cache", () => ({ updateTag: vi.fn(), unstable_cache: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("siteUrl", () => {
  it("exposes the normalized public origin of SITE_URL", async () => {
    vi.resetModules();
    stubValidEnv({ SITE_URL: "https://auracard.fr/" });

    const { siteUrl } = await import("@/server/container");

    expect(siteUrl).toBe("https://auracard.fr");
  });
});
