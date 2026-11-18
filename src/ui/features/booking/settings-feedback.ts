import type { BookingSettingsState } from "@/server/booking/actions";
import { BOOKING_SETTINGS_ERROR_MESSAGES, LIMIT_REACHED_MESSAGES } from "@/ui/features/booking/messages";

export type LimitSection = keyof typeof LIMIT_REACHED_MESSAGES;

export type SettingsFeedback = {
  saved: boolean;
  /** Form-level message, `role="alert"`; `null` when there is none. */
  alert: string | null;
  /** Names of the fields the action refused. */
  fields: readonly string[];
  /** The fields were refused as malformed (their own message), not by a rule stated in `alert`. */
  invalidInput: boolean;
};

const NO_FEEDBACK: SettingsFeedback = { saved: false, alert: null, fields: [], invalidInput: false };

export function toSettingsFeedback(state: BookingSettingsState, section?: LimitSection): SettingsFeedback {
  if (state.status === "idle") {
    return NO_FEEDBACK;
  }
  if (state.status === "saved") {
    return { ...NO_FEEDBACK, saved: true };
  }
  const alert =
    state.error === "limit_reached" && section !== undefined
      ? LIMIT_REACHED_MESSAGES[section]
      : BOOKING_SETTINGS_ERROR_MESSAGES[state.error];
  return { saved: false, alert, fields: state.fields ?? [], invalidInput: state.error === "invalid_input" };
}

/** Message of each refused field known to `messages`: its own when malformed, otherwise the rule of the alert. */
export function fieldErrorsOf<F extends string>(
  feedback: SettingsFeedback,
  messages: Readonly<Record<F, string>>,
): Partial<Record<F, string>> {
  const errors: Partial<Record<F, string>> = {};
  for (const field of feedback.fields) {
    if (Object.hasOwn(messages, field)) {
      errors[field as F] = feedback.invalidInput ? messages[field as F] : (feedback.alert ?? messages[field as F]);
    }
  }
  return errors;
}
