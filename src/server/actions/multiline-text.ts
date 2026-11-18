import { z } from "zod";

import { FORBIDDEN_LABEL_CHARACTERS } from "@/domain/profile/link";

/** `\r\n` and lone `\r` → `\n`, trimmed, at most `maxLength`; no forbidden character except `\n`. No minimal length. */
export function multilineText(maxLength: number): z.ZodType<string, string> {
  return z
    .string()
    .transform((text) => text.replace(/\r\n?/g, "\n").trim())
    .pipe(
      z
        .string()
        .max(maxLength)
        .refine((text) => !FORBIDDEN_LABEL_CHARACTERS.test(text.replace(/\n/g, ""))),
    );
}
