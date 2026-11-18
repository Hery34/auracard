"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { LeadInvalidField } from "@/domain/lead/lead";
import { textFields } from "@/server/actions/form-fields";
import { parseLeadSubmission } from "@/server/actions/lead-schemas";
import { createContainer, createPublicContainer } from "@/server/container";
import type { CaptureLeadError } from "@/server/use-cases/capture-lead";
import type { DeleteOwnLeadError } from "@/server/use-cases/delete-own-lead";

export type CaptureLeadActionError = "invalid_input" | CaptureLeadError;

export type CaptureLeadState =
  | { status: "idle" }
  | { status: "error"; error: CaptureLeadActionError; fields?: LeadInvalidField[] }
  | { status: "sent" };

export type DeleteLeadActionError = "invalid_input" | Exclude<DeleteOwnLeadError, "unauthenticated">;

export type DeleteLeadState = { status: "idle" } | { status: "error"; error: DeleteLeadActionError } | { status: "deleted" };

const LEAD_FIELDS = ["slug", "name", "email", "message", "consent", "idempotencyKey", "cf-turnstile-response"] as const;
const MESSAGES_PATH = "/tableau-de-bord/messages";
const SIGN_IN_PATH = "/connexion";

const deleteLeadSchema = z.object({ leadId: z.uuid() });

/**
 * Public form: the only validation of the submission (field errors); the use case then checks the slug, the token,
 * the rate limits and Turnstile. No submitted value is ever echoed in the returned state.
 */
export async function captureLeadAction(_previous: CaptureLeadState, formData: FormData): Promise<CaptureLeadState> {
  const fields = textFields(formData, LEAD_FIELDS);
  const draft = {
    name: fields.name,
    email: fields.email,
    message: fields.message,
    consent: fields.consent,
    idempotencyKey: fields.idempotencyKey,
  };
  const parsed = parseLeadSubmission(draft);
  if (!parsed.ok) {
    return { status: "error", error: "invalid_input", fields: parsed.error };
  }
  const { captureLead } = createPublicContainer();
  const result = await captureLead(
    { ...parsed.value, slug: fields.slug ?? "", challengeToken: fields["cf-turnstile-response"] },
    await headers(),
  );
  return result.ok ? { status: "sent" } : { status: "error", error: result.error };
}

/** Field `leadId`; the session, the rate limit and the ownership are checked by the use case. Replayable. */
export async function deleteLeadAction(_previous: DeleteLeadState, formData: FormData): Promise<DeleteLeadState> {
  const parsed = deleteLeadSchema.safeParse(textFields(formData, ["leadId"]));
  if (!parsed.success) {
    return { status: "error", error: "invalid_input" };
  }
  const { deleteOwnLead } = await createContainer();
  const result = await deleteOwnLead(parsed.data.leadId);
  if (!result.ok) {
    if (result.error === "unauthenticated") {
      redirect(SIGN_IN_PATH);
    }
    return { status: "error", error: result.error };
  }
  revalidatePath(MESSAGES_PATH);
  return { status: "deleted" };
}
