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

  it("nfc-activate: 30 activation attempts per address per hour (0025, decision 4)", () => {
    expect(RATE_LIMITS["nfc-activate"]).toStrictEqual({ limit: 30, windowSeconds: 3600 });
  });

  it("beacon: 300 statistics events per address per hour (0029, decision 6)", () => {
    expect(RATE_LIMITS.beacon).toStrictEqual({ limit: 300, windowSeconds: 3600 });
  });

  it("scan: 60 server events (/t, /q, /v) per address per hour (0029, decision 9)", () => {
    expect(RATE_LIMITS.scan).toStrictEqual({ limit: 60, windowSeconds: 3600 });
  });

  it("lead: 5 messages per address per hour (0032, decision 2)", () => {
    expect(RATE_LIMITS.lead).toStrictEqual({ limit: 5, windowSeconds: 3600 });
  });

  it("lead-profile: 50 messages per profile per 23 hours (0032, decisions 2 and 12)", () => {
    expect(RATE_LIMITS["lead-profile"]).toStrictEqual({ limit: 50, windowSeconds: 82800 });
  });

  it("defines exactly the ten scopes signup, login, login-account, profile-write, vcard, nfc-activate, beacon, scan, lead and lead-profile", () => {
    expect(Object.keys(RATE_LIMITS).sort()).toStrictEqual([
      "beacon",
      "lead",
      "lead-profile",
      "login",
      "login-account",
      "nfc-activate",
      "profile-write",
      "scan",
      "signup",
      "vcard",
    ]);
  });
});

describe("LONGEST_RATE_LIMIT_WINDOW_SECONDS", () => {
  it("is 82800 seconds since 0032 (lead-profile, 23 hours, decision 12), the longest window (minimal purge argument)", () => {
    expect(LONGEST_RATE_LIMIT_WINDOW_SECONDS).toBe(82800);
  });

  it("equals the maximum of all configured windows", () => {
    const windows = Object.values(RATE_LIMITS).map((limit) => limit.windowSeconds);

    expect(LONGEST_RATE_LIMIT_WINDOW_SECONDS).toBe(Math.max(...windows));
  });
});
