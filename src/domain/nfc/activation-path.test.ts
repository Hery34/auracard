/**
 * Contract frozen by test-engineer (0025, decisions 5 and 7): the only return path accepted after sign-in.
 *
 * // src/domain/nfc/activation-path.ts
 * export function activationPath(uid: string): string;          // `/activer/${uid}`
 * // true only when `value` is a string matching exactly ^/activer/[0-9a-hjkmnp-tv-z]{12}$ (no decoding, no trimming).
 * export function isActivationPath(value: unknown): value is string;
 * // Decision 13: sign-in link of /activer/{uid} and redirection of the action without session, one encoding.
 * export function signInToActivatePath(uid: string): string;   // `/connexion?suivant=%2Factiver%2F${uid}`
 */
import { describe, expect, it } from "vitest";

import { activationPath, isActivationPath, signInToActivatePath } from "@/domain/nfc/activation-path";

import { HOSTILE_RETURN_PATHS, TAG_UID } from "../../../tests/builders/nfc";

describe("activationPath", () => {
  it("is /activer/{uid}", () => {
    expect(activationPath(TAG_UID)).toBe(`/activer/${TAG_UID}`);
  });
});

describe("isActivationPath (decision 7: allow-list, exact match)", () => {
  it("accepts /activer/{uid} for a well-formed uid", () => {
    expect(isActivationPath(`/activer/${TAG_UID}`)).toBe(true);
    expect(isActivationPath(activationPath("0123456789ab"))).toBe(true);
  });

  it.each(HOSTILE_RETURN_PATHS)("criterion 4: refuses %s", (_label, value) => {
    expect(isActivationPath(value)).toBe(false);
  });

  it.each([null, undefined, 42, [`/activer/${TAG_UID}`]])("refuses a non-string value %j", (value) => {
    expect(isActivationPath(value)).toBe(false);
  });
});

describe("signInToActivatePath (decision 13)", () => {
  it("is /connexion?suivant=%2Factiver%2F{uid}", () => {
    expect(signInToActivatePath(TAG_UID)).toBe(`/connexion?suivant=%2Factiver%2F${TAG_UID}`);
  });

  it("its suivant parameter decodes to the activation path, which the allow-list accepts", () => {
    const suivant = new URL(signInToActivatePath(TAG_UID), "https://carnet.example").searchParams.get("suivant");

    expect(suivant).toBe(activationPath(TAG_UID));
    expect(isActivationPath(suivant)).toBe(true);
  });
});
