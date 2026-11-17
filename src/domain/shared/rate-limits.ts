export type RateLimitScope = "signup" | "login" | "login-account" | "profile-write" | "vcard" | "nfc-activate";

export type RateLimit = { limit: number; windowSeconds: number };

export const RATE_LIMITS: Readonly<Record<RateLimitScope, RateLimit>> = {
  signup: { limit: 10, windowSeconds: 3600 },
  login: { limit: 10, windowSeconds: 900 },
  "login-account": { limit: 10, windowSeconds: 900 },
  "profile-write": { limit: 60, windowSeconds: 3600 },
  vcard: { limit: 30, windowSeconds: 3600 },
  "nfc-activate": { limit: 30, windowSeconds: 3600 },
};

/** Minimal argument of the purge: no window older than this can still be active. */
export const LONGEST_RATE_LIMIT_WINDOW_SECONDS: number = Math.max(
  ...Object.values(RATE_LIMITS).map((rateLimit) => rateLimit.windowSeconds),
);
