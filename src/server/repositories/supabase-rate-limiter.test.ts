import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSupabaseRateLimiter, rateLimitKey } from "@/server/repositories/supabase-rate-limiter";

import { fakeSupabaseAdmin } from "../../../tests/builders/fake-supabase-admin";

const SECRET = "0123456789abcdef".repeat(4);
const OTHER_SECRET = "fedcba9876543210".repeat(4);
const ADDRESS = "203.0.113.9";

describe("rateLimitKey", () => {
  it("is '<scope>:' followed by 64 lowercase hex characters", () => {
    expect(rateLimitKey(SECRET, "signup", ADDRESS)).toMatch(/^signup:[0-9a-f]{64}$/);
    expect(rateLimitKey(SECRET, "login-account", "elodie@example.test")).toMatch(/^login-account:[0-9a-f]{64}$/);
  });

  it("matches the storage contract ^[a-z-]+:[0-9a-f]{64}$ and stays within the 128-character key limit", () => {
    const key = rateLimitKey(SECRET, "login-account", ADDRESS);

    expect(key).toMatch(/^[a-z-]+:[0-9a-f]{64}$/);
    expect(key.length).toBeLessThanOrEqual(128);
  });

  it("is the HMAC-SHA256 of '<scope>:<subject>' keyed by the secret", () => {
    const expected = createHmac("sha256", SECRET).update(`signup:${ADDRESS}`).digest("hex");

    expect(rateLimitKey(SECRET, "signup", ADDRESS)).toBe(`signup:${expected}`);
  });

  it("never contains the subject (address or e-mail) in clear", () => {
    expect(rateLimitKey(SECRET, "signup", ADDRESS)).not.toContain(ADDRESS);
    expect(rateLimitKey(SECRET, "login-account", "elodie@example.test")).not.toContain("elodie");
  });

  it("is stable for the same secret, scope and subject", () => {
    expect(rateLimitKey(SECRET, "signup", ADDRESS)).toBe(rateLimitKey(SECRET, "signup", ADDRESS));
  });

  it("changes with the secret", () => {
    expect(rateLimitKey(SECRET, "signup", ADDRESS)).not.toBe(rateLimitKey(OTHER_SECRET, "signup", ADDRESS));
  });

  it("changes with the scope (the scope is part of the hashed input, not only the prefix)", () => {
    const signup = rateLimitKey(SECRET, "signup", ADDRESS);
    const login = rateLimitKey(SECRET, "login", ADDRESS);

    expect(signup.split(":")[1]).not.toBe(login.split(":")[1]);
  });

  it("changes with the subject", () => {
    expect(rateLimitKey(SECRET, "signup", ADDRESS)).not.toBe(rateLimitKey(SECRET, "signup", "203.0.113.10"));
  });
});

describe("makeSupabaseRateLimiter", () => {
  const input = { scope: "signup" as const, subject: ADDRESS, limit: 10, windowSeconds: 3600 };

  it("calls rpc('consume_rate_limit') with the hashed key, the limit and the window as a Postgres interval", async () => {
    const admin = fakeSupabaseAdmin({ data: true, error: null });

    await makeSupabaseRateLimiter(admin.client, SECRET).consume(input);

    expect(admin.calls).toStrictEqual([
      {
        fn: "consume_rate_limit",
        args: { p_key: rateLimitKey(SECRET, "signup", ADDRESS), p_limit: 10, p_window: "3600 seconds" },
      },
    ]);
  });

  it("never sends the raw subject to the database", async () => {
    const admin = fakeSupabaseAdmin({ data: true, error: null });

    await makeSupabaseRateLimiter(admin.client, SECRET).consume(input);

    expect(JSON.stringify(admin.calls)).not.toContain(ADDRESS);
  });

  it("maps a true answer to ok({ allowed: true })", async () => {
    const admin = fakeSupabaseAdmin({ data: true, error: null });

    expect(await makeSupabaseRateLimiter(admin.client, SECRET).consume(input)).toStrictEqual(ok({ allowed: true }));
  });

  it("maps a false answer to ok({ allowed: false })", async () => {
    const admin = fakeSupabaseAdmin({ data: false, error: null });

    expect(await makeSupabaseRateLimiter(admin.client, SECRET).consume(input)).toStrictEqual(ok({ allowed: false }));
  });

  it("maps a PostgREST error to err('unexpected')", async () => {
    const admin = fakeSupabaseAdmin({
      data: null,
      error: { code: "42501", message: "permission denied for function consume_rate_limit", details: null, hint: null },
    });

    expect(await makeSupabaseRateLimiter(admin.client, SECRET).consume(input)).toStrictEqual(err("unexpected"));
  });
});
