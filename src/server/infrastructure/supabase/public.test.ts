/**
 * Contract frozen by test-engineer (0017, decision 6).
 *
 * // src/server/infrastructure/supabase/public.ts
 * export function createPublicSupabaseClient(): CarnetClient;
 * // anon key, schema carnet, no cookies read nor written (static rendering), no session persisted.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { stubValidEnv } from "../../../../tests/builders/env";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), headers: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: async () => {
    mocks.cookies();
    throw new Error("cookies() read outside a request: the public client must not depend on cookies");
  },
  headers: async () => {
    mocks.headers();
    throw new Error("headers() read: the public client must not depend on the request");
  },
}));

let publicModule: typeof import("@/server/infrastructure/supabase/public");

beforeAll(async () => {
  stubValidEnv();
  publicModule = await import("@/server/infrastructure/supabase/public");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("createPublicSupabaseClient", () => {
  it("decision 6: builds a client without reading the request cookies nor headers (static rendering)", () => {
    const client = publicModule.createPublicSupabaseClient();

    expect(typeof client.rpc).toBe("function");
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.headers).not.toHaveBeenCalled();
  });

  it("is synchronous: no request-scoped API awaited", () => {
    const client: unknown = publicModule.createPublicSupabaseClient();

    expect(client).not.toBeInstanceOf(Promise);
  });
});
