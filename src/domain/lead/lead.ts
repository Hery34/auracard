/** Length checks of `carnet.leads` (0031). */
export const LEAD_TEXT_MAX_LENGTH = { name: 100, email: 254, message: 2000 } as const;

/** The Turnstile widget's `action`; its `cData` is the slug, binding the token to the profile (0032, decision 14). */
export const LEAD_CHALLENGE_ACTION = "lead";

export const LEAD_INVALID_FIELDS = ["name", "email", "message", "consent", "idempotencyKey"] as const;
export type LeadInvalidField = (typeof LEAD_INVALID_FIELDS)[number];

export type LeadSubmission = { name: string; email: string; message: string; idempotencyKey: string };

/** A visitor's message as its owner reads it; `createdAt` is the timestamptz text of PostgREST, kept as is. */
export type OwnLead = { id: string; name: string; email: string; message: string; createdAt: string };
