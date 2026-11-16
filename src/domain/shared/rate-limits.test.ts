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

  it("defines exactly the three scopes signup, login and login-account", () => {
    expect(Object.keys(RATE_LIMITS).sort()).toStrictEqual(["login", "login-account", "signup"]);
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
