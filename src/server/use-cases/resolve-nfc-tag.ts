import { isNfcTagUid, type NfcResolution } from "@/domain/nfc/nfc-tag";
import type { NfcTagResolver } from "@/domain/nfc/ports";
import { ok, type Result } from "@/domain/shared/result";

export type ResolveNfcTag = (uid: string) => Promise<Result<NfcResolution, "unexpected">>;

/** Target of `/t/{uid}`; a malformed uid never reaches the database. No side effect (scan event: phase 4). */
export function makeResolveNfcTag(deps: { tags: NfcTagResolver }): ResolveNfcTag {
  return async (uid) => {
    if (!isNfcTagUid(uid)) {
      return ok({ state: "not_found" });
    }
    return deps.tags.resolve(uid);
  };
}
