"use client";

import { EXCEPTION_KINDS } from "@/domain/booking/availability";
import { addAvailabilityExceptionAction } from "@/server/booking/actions";
import { ActionFeedback } from "@/ui/features/booking/action-feedback";
import { EXCEPTION_FIELD_ERROR_MESSAGES, EXCEPTION_KIND_LABELS } from "@/ui/features/booking/messages";
import { SelectField } from "@/ui/features/booking/select-field";
import { fieldErrorsOf, toSettingsFeedback } from "@/ui/features/booking/settings-feedback";
import { useSettingsForm } from "@/ui/features/booking/use-settings-form";
import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";

/**
 * Start and end are typed at the wall-clock time of `timeZone`, the profile's zone; the action converts them.
 * `id`, drawn by the page, is the idempotency key; a new one after a success remounts (empties) the form.
 */
export function AddExceptionForm({ id, timeZone }: { id: string; timeZone: string }) {
  const { state, pending, submit } = useSettingsForm(addAvailabilityExceptionAction);
  const feedback = toSettingsFeedback(state, "exceptions");
  const errors = fieldErrorsOf(feedback, EXCEPTION_FIELD_ERROR_MESSAGES);
  const hint = `Heure du fuseau ${timeZone}.`;

  return (
    <div className="flex flex-col gap-4">
      <form key={id} onSubmit={submit} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={id} />
        <SelectField id="exception-kind" name="kind" label="Nature" error={errors.kind}>
          {EXCEPTION_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {EXCEPTION_KIND_LABELS[kind]}
            </option>
          ))}
        </SelectField>
        <Field id="exception-start" name="start" label="Début" type="datetime-local" required error={errors.start} hint={hint} />
        <Field id="exception-end" name="end" label="Fin" type="datetime-local" required error={errors.end} hint={hint} />
        <Button type="submit" disabled={pending} className="self-start">
          Ajouter
        </Button>
      </form>
      <ActionFeedback feedback={feedback} />
    </div>
  );
}
