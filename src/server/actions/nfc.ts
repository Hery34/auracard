"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { signInToActivatePath } from "@/domain/nfc/activation-path";
import { textFields } from "@/server/actions/form-fields";
import { activateNfcTagSchema, releaseNfcTagSchema, setNfcTagEnabledSchema } from "@/server/actions/nfc-schemas";
import { createContainer } from "@/server/container";
import { requestClientAddress } from "@/server/infrastructure/request-client-address";
import type { ActivateNfcTagError } from "@/server/use-cases/activate-nfc-tag";
import type { ReleaseNfcTagError } from "@/server/use-cases/release-nfc-tag";
import type { SetNfcTagEnabledError } from "@/server/use-cases/set-nfc-tag-enabled";

export type ActivateNfcTagActionError = "invalid_input" | Exclude<ActivateNfcTagError, "unauthenticated">;

export type ActivateNfcTagState = { status: "idle" } | { status: "error"; error: ActivateNfcTagActionError };

export type NfcTagActionError = "invalid_input" | Exclude<SetNfcTagEnabledError | ReleaseNfcTagError, "unauthenticated">;

export type NfcTagActionState = { status: "idle" } | { status: "error"; error: NfcTagActionError } | { status: "saved" };

const MY_TAGS_PATH = "/tableau-de-bord/puces";
const SIGN_IN_PATH = "/connexion";

/**
 * Fields `uid` (hidden) and `code`. The session, the membership, the rate limits and the code are checked by the use
 * case; no submitted value is ever echoed in the returned state.
 */
export async function activateNfcTagAction(
  _previous: ActivateNfcTagState,
  formData: FormData,
): Promise<ActivateNfcTagState> {
  const parsed = activateNfcTagSchema.safeParse(textFields(formData, ["uid", "code"]));
  if (!parsed.success) {
    return { status: "error", error: "invalid_input" };
  }
  const { uid, code } = parsed.data;
  const { activateNfcTag } = await createContainer();
  const result = await activateNfcTag({ uid, code, clientAddress: requestClientAddress(await headers()) });
  if (!result.ok) {
    if (result.error === "unauthenticated") {
      redirect(signInToActivatePath(uid));
    }
    return { status: "error", error: result.error };
  }
  redirect(MY_TAGS_PATH);
}

/** Fields `tagId` and `enabled` (`"true"` | `"false"`); replayable. */
export async function setNfcTagEnabledAction(
  _previous: NfcTagActionState,
  formData: FormData,
): Promise<NfcTagActionState> {
  const parsed = setNfcTagEnabledSchema.safeParse(textFields(formData, ["tagId", "enabled"]));
  if (!parsed.success) {
    return { status: "error", error: "invalid_input" };
  }
  const { setNfcTagEnabled } = await createContainer();
  return savedOrError(await setNfcTagEnabled(parsed.data));
}

/** Field `tagId`; the confirmation is asked by the page. Replayed, or someone else's tag: saved, nothing done. */
export async function releaseNfcTagAction(_previous: NfcTagActionState, formData: FormData): Promise<NfcTagActionState> {
  const parsed = releaseNfcTagSchema.safeParse(textFields(formData, ["tagId"]));
  if (!parsed.success) {
    return { status: "error", error: "invalid_input" };
  }
  const { releaseNfcTag } = await createContainer();
  return savedOrError(await releaseNfcTag(parsed.data.tagId));
}

function savedOrError(
  result: { ok: true } | { ok: false; error: SetNfcTagEnabledError | ReleaseNfcTagError },
): NfcTagActionState {
  if (!result.ok) {
    if (result.error === "unauthenticated") {
      redirect(SIGN_IN_PATH);
    }
    return { status: "error", error: result.error };
  }
  revalidatePath(MY_TAGS_PATH);
  return { status: "saved" };
}
