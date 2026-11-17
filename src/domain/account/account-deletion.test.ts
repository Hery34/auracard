/**
 * Contract frozen by test-engineer (0023, decision 1, criterion 4).
 *
 * // src/domain/account/account-deletion.ts
 * export const ACCOUNT_DELETION_CONFIRMATION = "SUPPRIMER";
 * // True only for the exact string "SUPPRIMER": case-sensitive, no trimming, no Unicode normalization, any other type false.
 * export function isAccountDeletionConfirmed(value: unknown): boolean;
 *
 * // src/domain/account/ports.ts — ports of the use case `delete-account` (implemented in src/server/).
 * export interface MediaFolderCleaner {
 *   // Folder `carnet-media/<profileId>/` under the session of the caller: every object removed; already empty = success.
 *   empty(profileId: string): Promise<Result<void, "unexpected">>;
 * }
 * export interface CarnetAccountEraser {
 *   // `carnet.delete_own_account()` under the session: answers the slug of the deleted profile, null when none
 *   // (replay, no profile); nothing left to delete = success.
 *   erase(): Promise<Result<string | null, "unexpected">>;
 * }
 * export interface InstanceAccountRemover {
 *   // service_role (ADR 0011): `carnet.is_orphan_account(p_user_id)`.
 *   isOrphan(userId: string): Promise<Result<boolean, "unexpected">>;
 *   // service_role: `auth.admin.deleteUser(userId)` (hard delete); an account already absent (404) = success.
 *   remove(userId: string): Promise<Result<void, "unexpected">>;
 * }
 * export interface PublicProfileCache {
 *   // Expires the cached public read of `/p/{slug}` (container: updateTag(profileCacheTag(slug))).
 *   expire(slug: string): void;
 * }
 */
import { describe, expect, it } from "vitest";

import { ACCOUNT_DELETION_CONFIRMATION, isAccountDeletionConfirmed } from "@/domain/account/account-deletion";

describe("account deletion confirmation (criterion 4)", () => {
  it("the word to type is exactly SUPPRIMER", () => {
    expect(ACCOUNT_DELETION_CONFIRMATION).toBe("SUPPRIMER");
  });

  it("criterion 4: SUPPRIMER typed exactly → confirmed", () => {
    expect(isAccountDeletionConfirmed("SUPPRIMER")).toBe(true);
  });

  it.each([
    ["absent (null)", null],
    ["undefined", undefined],
    ["empty", ""],
    ["lower case", "supprimer"],
    ["capitalized", "Supprimer"],
    ["with a trailing space", "SUPPRIMER "],
    ["with a leading space", " SUPPRIMER"],
    ["with a newline", "SUPPRIMER\n"],
    ["truncated", "SUPPRIME"],
    ["extended", "SUPPRIMERR"],
    ["with an accent", "SUPPRIMÉR"],
    ["with a zero-width space", "SUPP​RIMER"],
    ["in full-width letters", "ＳＵＰＰＲＩＭＥＲ"],
    ["another word", "DELETE"],
    ["a file (not a string)", new Blob(["SUPPRIMER"])],
    ["an array", ["SUPPRIMER"]],
  ])("criterion 4: confirmation %s → not confirmed", (_label, value) => {
    expect(isAccountDeletionConfirmed(value)).toBe(false);
  });
});
