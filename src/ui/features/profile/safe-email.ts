import { z } from "zod";

import { PROFILE_TEXT_MAX_LENGTH } from "@/domain/profile/profile";

/**
 * The stored `contact_email` is untrusted (direct PostgREST writes): shown only when it has the editor's format
 * (`z.email()`), so no `?`, `&`, `/` or `:` can reach a `mailto:` URL.
 */
export function safeEmail(value: string | null): string | null {
  if (value === null || value.length > PROFILE_TEXT_MAX_LENGTH.contactEmail) {
    return null;
  }
  return z.regexes.email.test(value) ? value : null;
}
