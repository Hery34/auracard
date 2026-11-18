import { z } from "zod";

import {
  LEAD_INVALID_FIELDS,
  LEAD_TEXT_MAX_LENGTH,
  type LeadInvalidField,
  type LeadSubmission,
} from "@/domain/lead/lead";
import { FORBIDDEN_LABEL_CHARACTERS } from "@/domain/profile/link";
import { err, ok, type Result } from "@/domain/shared/result";
import { multilineText } from "@/server/actions/multiline-text";

/** Text fields of the contact form; an absent field is `undefined`. */
export type LeadDraft = {
  name: string | undefined;
  email: string | undefined;
  message: string | undefined;
  consent: string | undefined;
  idempotencyKey: string | undefined;
};

/** Unknown keys stripped; the consent is checked, then dropped (`consent_at` is set by the database). */
export const leadSubmissionSchema: z.ZodType<LeadSubmission, LeadDraft> = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(LEAD_TEXT_MAX_LENGTH.name)
      .refine((text) => !FORBIDDEN_LABEL_CHARACTERS.test(text)),
    email: z.string().trim().pipe(z.email().max(LEAD_TEXT_MAX_LENGTH.email)),
    message: multilineText(LEAD_TEXT_MAX_LENGTH.message).pipe(z.string().min(1)),
    consent: z.literal("on"),
    idempotencyKey: z.uuid().transform((key) => key.toLowerCase()),
  })
  .transform(({ name, email, message, idempotencyKey }) => ({ name, email, message, idempotencyKey }));

/** Every invalid field in form order; never echoes a value. */
export function parseLeadSubmission(draft: LeadDraft): Result<LeadSubmission, LeadInvalidField[]> {
  const parsed = leadSubmissionSchema.safeParse(draft);
  if (parsed.success) {
    return ok(parsed.data);
  }
  const invalid = new Set(parsed.error.issues.map((issue) => issue.path[0]));
  return err(LEAD_INVALID_FIELDS.filter((field) => invalid.has(field)));
}
