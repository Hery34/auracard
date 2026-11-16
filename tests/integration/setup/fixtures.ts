import { randomBytes } from "node:crypto";

/** Per-process token: isolates e-mails, slugs and rate-limit keys between runs and between test files. */
export const RUN_ID = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;

/** Secret of the rate limiter under test: unique per process, so its keys never meet a previous run's counters. */
export const RUN_SECRET = randomBytes(32).toString("hex");

export const PASSWORD = "correct horse battery staple";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let emailCounter = 0;
let addressCounter = 0;
let nameCounter = 0;

export function uniqueEmail(): string {
  emailCounter += 1;
  return `it-0007-${RUN_ID}-${emailCounter}@example.test`;
}

/** TEST-NET-3 addresses: one per test, never reused within a process. */
export function uniqueAddress(): string {
  addressCounter += 1;
  return `203.0.113.${addressCounter}`;
}

/** A display name unique to this run and the slug `slugFromDisplayName` must derive from it. */
export function uniqueDisplayName(): { displayName: string; slug: string } {
  nameCounter += 1;
  return { displayName: `IT 0007 ${RUN_ID} ${nameCounter}`, slug: `it-0007-${RUN_ID}-${nameCounter}` };
}
