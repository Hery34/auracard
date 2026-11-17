"use server";

import { redirect } from "next/navigation";

import { deleteAccountSchema } from "@/server/actions/account-schemas";
import { textFields } from "@/server/actions/form-fields";
import { deleteSessionCookies } from "@/server/actions/session-cookies";
import { createContainer } from "@/server/container";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { DeleteAccountError } from "@/server/use-cases/delete-account";

export type DeleteAccountActionError = "invalid_confirmation" | Exclude<DeleteAccountError, "unauthenticated">;

export type DeleteAccountState = { status: "idle" } | { status: "error"; error: DeleteAccountActionError };

const HOME_AFTER_DELETION_PATH = "/?compte=supprime";
const SIGN_IN_PATH = "/connexion";

/**
 * Field `confirmation` (`SUPPRIMER`). The account is the session's, checked by the use case; nothing is read before the
 * confirmation. Without session (stale cookies of an account already deleted): session cookies cleared, then the sign-in
 * page. Once deleted: local sign-out (a failure is logged), every session cookie cleared (GoTrue may already have
 * forgotten the account), then the home page.
 */
export async function deleteAccountAction(_previous: DeleteAccountState, formData: FormData): Promise<DeleteAccountState> {
  const parsed = deleteAccountSchema.safeParse(textFields(formData, ["confirmation"]));
  if (!parsed.success) {
    return { status: "error", error: "invalid_confirmation" };
  }
  const { deleteAccount, auth } = await createContainer();
  const result = await deleteAccount();
  if (!result.ok) {
    if (result.error === "unauthenticated") {
      await deleteSessionCookies();
      redirect(SIGN_IN_PATH);
    }
    return { status: "error", error: result.error };
  }
  const signedOut = await auth.signOut();
  if (!signedOut.ok) {
    logInfrastructureError("auth.signOut", signedOut.error);
  }
  await deleteSessionCookies();
  redirect(HOME_AFTER_DELETION_PATH, "replace");
}
