import type { ActivationOutcome, NfcResolution, OwnNfcTag } from "@/domain/nfc/nfc-tag";
import type { Result } from "@/domain/shared/result";

/** `not_member`: the caller is not a member of carnet. */
export type NfcTagRepositoryError = "not_member" | "unexpected";

/** Anonymous resolution of `/t/{uid}`. */
export interface NfcTagResolver {
  resolve(uid: string): Promise<Result<NfcResolution, "unexpected">>;
}

/** Anonymous resolution of `/q/{code}`: slug of the published profile, or `null`. */
export interface QrCodeResolver {
  resolve(code: string): Promise<Result<string | null, "unexpected">>;
}

/** Under the session of the caller: only their own tags are seen or changed. */
export interface NfcTagRepository {
  activate(uid: string, code: string): Promise<Result<ActivationOutcome, NfcTagRepositoryError>>;
  listOwn(): Promise<Result<OwnNfcTag[], "unexpected">>;
  /** `false`: absent or someone else's. */
  setEnabled(tagId: string, enabled: boolean): Promise<Result<boolean, NfcTagRepositoryError>>;
  /** `false`: already in stock, absent or someone else's. */
  release(tagId: string): Promise<Result<boolean, NfcTagRepositoryError>>;
}
