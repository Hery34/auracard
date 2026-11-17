import type { OwnNfcTag } from "@/domain/nfc/nfc-tag";
import type { NfcTagRepository } from "@/domain/nfc/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import { err, type Result } from "@/domain/shared/result";

export type ListOwnNfcTagsError = "unauthenticated" | "unexpected";

export type ListOwnNfcTags = () => Promise<Result<OwnNfcTag[], ListOwnNfcTagsError>>;

/** The caller's tags (RLS); an account of another project sees none. */
export function makeListOwnNfcTags(deps: { auth: AuthGateway; tags: NfcTagRepository }): ListOwnNfcTags {
  return async () => {
    const user = await deps.auth.currentUser();
    if (!user.ok) {
      return err("unexpected");
    }
    if (user.value === null) {
      return err("unauthenticated");
    }
    return deps.tags.listOwn();
  };
}
