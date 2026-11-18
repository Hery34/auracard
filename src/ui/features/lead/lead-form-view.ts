import type { LeadInvalidField } from "@/domain/lead/lead";
import type { CaptureLeadState } from "@/server/actions/lead";
import { CAPTURE_LEAD_ERROR_MESSAGES, LEAD_FIELD_ERROR_MESSAGES } from "@/ui/features/lead/messages";

export type LeadFormView = {
  /** Form-level message, `role="alert"`; `null` when there is none. */
  alert: string | null;
  fieldErrors: Partial<Record<LeadInvalidField, string>>;
  sent: boolean;
};

/** `idempotencyKey` has no visible control: its message joins the form-level alert. */
export function toLeadFormView(state: CaptureLeadState): LeadFormView {
  if (state.status !== "error") {
    return { alert: null, fieldErrors: {}, sent: state.status === "sent" };
  }
  const fields = state.fields ?? [];
  const fieldErrors = Object.fromEntries(fields.map((field) => [field, LEAD_FIELD_ERROR_MESSAGES[field]]));
  const alert = fields.includes("idempotencyKey")
    ? `${CAPTURE_LEAD_ERROR_MESSAGES[state.error]} ${LEAD_FIELD_ERROR_MESSAGES.idempotencyKey}`
    : CAPTURE_LEAD_ERROR_MESSAGES[state.error];
  return { alert, fieldErrors, sent: false };
}

/** A refused or unchecked token cannot be sent again; field errors are caught before Cloudflare is called. */
export function needsNewChallenge(state: CaptureLeadState): boolean {
  return state.status === "error" && state.error !== "invalid_input";
}

/** Every refusal but `unexpected` excludes a write; after `unexpected` the same key keeps the replay idempotent. */
export function needsNewIdempotencyKey(state: CaptureLeadState): boolean {
  return state.status === "error" && state.error !== "unexpected";
}
