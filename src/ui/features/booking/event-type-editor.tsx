"use client";

import { useState } from "react";

import { updateEventTypeAction, type BookingSettingsState } from "@/server/booking/actions";
import { ActionFeedback } from "@/ui/features/booking/action-feedback";
import { EventTypeFields } from "@/ui/features/booking/event-type-fields";
import type { EventTypeRow } from "@/ui/features/booking/event-type-row";
import { EVENT_TYPE_FIELD_ERROR_MESSAGES } from "@/ui/features/booking/messages";
import { fieldErrorsOf, toSettingsFeedback } from "@/ui/features/booking/settings-feedback";
import { useSettingsForm } from "@/ui/features/booking/use-settings-form";
import { Button } from "@/ui/primitives/button";

const IDLE: BookingSettingsState = { status: "idle" };

/**
 * « Modifier » unfolds the form prefilled with the stored values. Only the answer received since the last opening is
 * shown; a success folds the form back.
 */
export function EventTypeEditor({ row }: { row: EventTypeRow }) {
  const { state, pending, submit } = useSettingsForm(updateEventTypeAction);
  const [openedAt, setOpenedAt] = useState<BookingSettingsState | null>(null);
  const answered = openedAt !== null && state !== openedAt;
  const open = openedAt !== null && !(answered && state.status === "saved");
  const feedback = toSettingsFeedback(answered ? state : IDLE);

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <Button type="button" variant="outline" onClick={() => setOpenedAt(state)}>
          Modifier<span className="sr-only"> le type {row.title}</span>
        </Button>
        <ActionFeedback feedback={feedback} />
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={row.id} />
      <EventTypeFields
        idPrefix={`event-type-${row.id}`}
        initial={row.draft}
        errors={fieldErrorsOf(feedback, EVENT_TYPE_FIELD_ERROR_MESSAGES)}
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={pending}>
          Enregistrer le type
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpenedAt(null)}>
          Annuler
        </Button>
      </div>
      <ActionFeedback feedback={feedback} />
    </form>
  );
}
