import { z } from "zod";

import { DISPLAY_NAME_MAX_LENGTH, EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./auth-limits";

export { DISPLAY_NAME_MAX_LENGTH, EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH };

const emailSchema = z.email().max(EMAIL_MAX_LENGTH);
const newPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
/** Accounts of the other projects of the shared instance may predate this minimum: only non-empty at sign-in. */
const existingPasswordSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);

/** Trimmed, 1 to DISPLAY_NAME_MAX_LENGTH characters, no control (Cc) nor format (Cf: U+202E, zero-width…) character. */
const displayNameSchema = z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH).regex(/^[^\p{Cc}\p{Cf}]*$/u);

export const registerSchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
  displayName: displayNameSchema,
});

/** `displayName` is asked only when the account has to join carnet: blank means absent. */
export const signInSchema = z.object({
  email: emailSchema,
  password: existingPasswordSchema,
  displayName: z.preprocess(blankToUndefined, displayNameSchema.optional()),
});

function blankToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}
