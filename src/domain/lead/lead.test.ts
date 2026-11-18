/**
 * Contract frozen by test-engineer (0032, decisions 9 and 14; bounds of 0031).
 *
 * // src/domain/lead/lead.ts — pure TypeScript: types and bounds only, no Zod (decision 14, architecture.md §3,
 * //   ADR 0012 §2). The schema and the parsing live in src/server/actions/lead-schemas.ts.
 * export const LEAD_TEXT_MAX_LENGTH = { name: 100, email: 254, message: 2000 } as const;
 * export const LEAD_INVALID_FIELDS = ["name", "email", "message", "consent", "idempotencyKey"] as const;
 * // Decision 14: the one action emitted by the widget (src/ui/features/lead/turnstile.ts) and compared by the use case.
 * export const LEAD_CHALLENGE_ACTION = "lead";
 * export type LeadInvalidField = (typeof LEAD_INVALID_FIELDS)[number];
 * export type LeadSubmission = { name: string; email: string; message: string; idempotencyKey: string };
 * // A message of a visitor as its owner reads it (createdAt: timestamptz text as returned by PostgREST, kept as is).
 * export type OwnLead = { id: string; name: string; email: string; message: string; createdAt: string };
 */
import { describe, expect, it } from "vitest";

import * as lead from "@/domain/lead/lead";

describe("lead bounds", () => {
  it("decision 9: same bounds as carnet.leads (0031)", () => {
    expect(lead.LEAD_TEXT_MAX_LENGTH).toStrictEqual({ name: 100, email: 254, message: 2000 });
    expect(lead.LEAD_INVALID_FIELDS).toStrictEqual(["name", "email", "message", "consent", "idempotencyKey"]);
  });

  it("decision 14: one challenge action shared by the widget and the use case", () => {
    expect(lead.LEAD_CHALLENGE_ACTION).toBe("lead");
  });

  it("decision 14: the domain no longer holds the Zod schema nor the parsing (src/server/actions/lead-schemas.ts)", () => {
    const exported = Object.keys(lead);

    expect(exported).not.toContain("leadSubmissionSchema");
    expect(exported).not.toContain("parseLeadSubmission");
  });
});
