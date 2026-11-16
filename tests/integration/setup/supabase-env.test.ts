import { afterEach, describe, expect, it, vi } from "vitest";

import setup, { ALLOW_REMOTE_VARIABLE, assertLocalSupabaseUrl } from "./supabase-env";

const LOCAL_STACK_MESSAGE = /pile locale/;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertLocalSupabaseUrl", () => {
  it.each(["http://127.0.0.1:54321", "http://localhost:54321", "https://localhost"])("accepts %s", (url) => {
    expect(() => assertLocalSupabaseUrl(url)).not.toThrow();
  });

  it.each([
    "https://db.example.com",
    "https://supabase.carnet.example",
    "http://192.168.1.10:54321",
    "http://[::1]:54321",
    "http://127.0.0.1.evil.test:54321",
    "http://localhost.evil.test",
  ])("refuses %s: the suite only runs against the local stack", (url) => {
    expect(() => assertLocalSupabaseUrl(url)).toThrow(LOCAL_STACK_MESSAGE);
  });

  it("refuses an invalid URL", () => {
    expect(() => assertLocalSupabaseUrl("not a url")).toThrow(/URL valide/);
  });

  it("lets a remote URL through only when allowRemote is true", () => {
    expect(() => assertLocalSupabaseUrl("https://db.example.com", true)).not.toThrow();
    expect(() => assertLocalSupabaseUrl("https://db.example.com", false)).toThrow(LOCAL_STACK_MESSAGE);
  });
});

describe("setup (globalSetup)", () => {
  it("refuses a preset remote NEXT_PUBLIC_SUPABASE_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example.com");
    vi.stubEnv(ALLOW_REMOTE_VARIABLE, undefined);

    expect(() => setup()).toThrow(LOCAL_STACK_MESSAGE);
  });

  it(`accepts a preset remote URL when ${ALLOW_REMOTE_VARIABLE}=1 and all variables are preset`, () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "preset-anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "preset-service-role-key");
    vi.stubEnv(ALLOW_REMOTE_VARIABLE, "1");

    expect(() => setup()).not.toThrow();
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://db.example.com");
  });

  it("keeps preset local variables untouched and never sets RATE_LIMIT_SECRET", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "preset-anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "preset-service-role-key");
    vi.stubEnv("RATE_LIMIT_SECRET", undefined);

    setup();

    expect(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("preset-anon-key");
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe("preset-service-role-key");
    expect(process.env.RATE_LIMIT_SECRET).toBeUndefined();
  });
});
