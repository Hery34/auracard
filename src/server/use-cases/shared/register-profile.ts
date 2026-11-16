import type { ProfileRegistrar } from "@/domain/profile/ports";
import { slugFromDisplayName, slugWithSuffix } from "@/domain/profile/slug";
import type { IdGenerator } from "@/domain/shared/ports/id-generator";
import { err, type Result } from "@/domain/shared/result";

export type RegisterProfileError = "slug_unavailable" | "registration_closed" | "unexpected";

const MAX_ATTEMPTS = 3;
const SUFFIX_LENGTH = 4;

/**
 * Membership plus initial profile for an account (idempotent through `register_member`). A taken slug
 * is retried with the base slug suffixed by the first hex characters of a fresh uuid, three attempts at most.
 */
export async function registerProfile(
  deps: { registrar: ProfileRegistrar; ids: IdGenerator },
  input: { userId: string; displayName: string },
): Promise<Result<{ profileId: string }, RegisterProfileError>> {
  const base = slugFromDisplayName(input.displayName);
  let slug = base;
  for (let attempt = 1; ; attempt += 1) {
    const result = await deps.registrar.register({ ...input, slug });
    if (result.ok) {
      return result;
    }
    if (result.error === "project_inactive") {
      return err("registration_closed");
    }
    if (result.error === "unexpected") {
      return err("unexpected");
    }
    if (attempt === MAX_ATTEMPTS) {
      return err("slug_unavailable");
    }
    slug = slugWithSuffix(base, deps.ids.uuid().slice(0, SUFFIX_LENGTH));
  }
}
