import { randomBytes } from "node:crypto";

import { slugFromDisplayName } from "../../../src/domain/profile/slug";

export type Account = { email: string; password: string; displayName: string; slug: string };

/** Every account created by the suite starts with this prefix: the global teardown deletes them all. */
export const E2E_EMAIL_PREFIX = "e2e-";

export const PASSWORD = "correct horse battery staple";

/** Per worker (each Playwright project runs in its own worker): e-mails and slugs never collide between projects. */
const RUN_ID = `${Date.now()}-${process.pid}`;

/**
 * Client address the suite presents to the application (`x-forwarded-for`, read by `clientAddressFrom`
 * under `pnpm start`): unique per worker, so the per-address signup/login counters of a run never meet
 * those of a previous run or of the other project. Documentation prefix 2001:db8::/32, aggregated to /64.
 */
const WORKER_ADDRESS = newClientAddress();

let counter = 0;

/** Fresh address in its own /64 (the aggregation unit of the per-address limits): a bucket no one has used. */
export function newClientAddress(): string {
  return `2001:db8:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}::1`;
}

export function workerAddress(): string {
  return WORKER_ADDRESS;
}

/**
 * Unique account per call. The display name is not derived from the e-mail (the slug must be found on the
 * dashboard by itself, not through an echoed e-mail) and the counter is zero-padded so no slug is a prefix
 * of another one of the same worker.
 */
export function newAccount(): Account {
  counter += 1;
  const sequence = String(counter).padStart(2, "0");
  const displayName = `Élodie E2E ${RUN_ID} ${sequence}`;
  return {
    email: `${E2E_EMAIL_PREFIX}${RUN_ID}-${sequence}@example.test`,
    password: PASSWORD,
    displayName,
    slug: slugFromDisplayName(displayName),
  };
}
