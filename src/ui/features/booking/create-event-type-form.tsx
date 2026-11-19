"use client";

import { createEventTypeAction } from "@/server/booking/actions";
import { ActionFeedback } from "@/ui/features/booking/action-feedback";
import { EventTypeFields } from "@/ui/features/booking/event-type-fields";
import { EVENT_TYPE_FIELD_ERROR_MESSAGES } from "@/ui/features/booking/messages";
import { fieldErrorsOf, toSettingsFeedback } from "@/ui/features/booking/settings-feedback";
import { useSettingsForm } from "@/ui/features/booking/use-settings-form";
import { Button } from "@/ui/primitives/button";

/** `id`, drawn by the page, is the idempotency key; a new one after a success remounts (empties) the form. */
export function CreateEventTypeForm({ id }: { id: string }) {
  const { state, pending, submit } = useSettingsForm(createEventTypeAction);
  const feedback = toSettingsFeedback(state, "eventTypes");

  return (
    <div className="flex flex-col gap-4">
      <form key={id} onSubmit={submit} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={id} />
        <EventTypeFields idPrefix="event-type-new" errors={fieldErrorsOf(feedback, EVENT_TYPE_FIELD_ERROR_MESSAGES)} />
        <Button type="submit" disabled={pending} className="self-start">
          Ajouter le type
        </Button>
      </form>
      <ActionFeedback feedback={feedback} />
    </div>
  );
}
