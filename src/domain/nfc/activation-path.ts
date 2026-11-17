import { NFC_TAG_UID_PATTERN } from "@/domain/nfc/nfc-tag";

const ACTIVATION_PATH_PATTERN = new RegExp(`^/activer/${NFC_TAG_UID_PATTERN.source.slice(1, -1)}$`);

export function activationPath(uid: string): string {
  return `/activer/${uid}`;
}

/** Allow-list of the return path after sign-in: exact match, no decoding, no trimming. */
export function isActivationPath(value: unknown): value is string {
  return typeof value === "string" && ACTIVATION_PATH_PATTERN.test(value);
}

/** Sign-in page that comes back to the activation page of `uid`. */
export function signInToActivatePath(uid: string): string {
  return `/connexion?suivant=${encodeURIComponent(activationPath(uid))}`;
}
