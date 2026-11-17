import { describe, expect, it } from "vitest";

import { LONGEST_RATE_LIMIT_WINDOW_SECONDS, RATE_LIMITS } from "@/domain/shared/rate-limits";

describe("RATE_LIMITS", () => {
  it("signup: 10 attempts per address per hour", () => {
    expect(RATE_LIMITS.signup).toStrictEqual({ limit: 10, windowSeconds: 3600 });
  });

  it("login: 10 attempts per address per 15 minutes", () => {
    expect(RATE_LIMITS.login).toStrictEqual({ limit: 10, windowSeconds: 900 });
  });

  it("login-account: 10 attempts per account per 15 minutes", () => {
    expect(RATE_LIMITS["login-account"]).toStrictEqual({ limit: 10, windowSeconds: 900 });
  });

  it("profile-write: 60 writes per account per hour (0017, decision 8)", () => {
    expect(RATE_LIMITS["profile-write"]).toStrictEqual({ limit: 60, windowSeconds: 3600 });
  });

  it("vcard: 30 downloads per address per hour (0019, decision 5)", () => {
    expect(RATE_LIMITS.vcard).toStrictEqual({ limit: 30, windowSeconds: 3600 });
  });

  it("defines exactly the five scopes signup, login, login-account, profile-write and vcard", () => {
    expect(Object.keys(RATE_LIMITS).sort()).toStrictEqual([
      "login",
      "login-account",
      "profile-write",
      "signup",
      "vcard",
    ]);
  });
});

describe("LONGEST_RATE_LIMIT_WINDOW_SECONDS", () => {
  it("is 3600 seconds, the longest window (minimal purge argument)", () => {
    expect(LONGEST_RATE_LIMIT_WINDOW_SECONDS).toBe(3600);
  });

  it("equals the maximum of all configured windows", () => {
    const windows = Object.values(RATE_LIMITS).map((limit) => limit.windowSeconds);

    expect(LONGEST_RATE_LIMIT_WINDOW_SECONDS).toBe(Math.max(...windows));
  });
});
