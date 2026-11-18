"use client";

import { useActionState } from "react";

import { setEventTypeActiveAction, type BookingSettingsState } from "@/server/booking/actions";
import { ActionFeedback } from "@/ui/features/booking/action-feedback";
import type { EventTypeRow } from "@/ui/features/booking/event-type-row";
import { toSettingsFeedback } from "@/ui/features/booking/settings-feedback";
import { Button } from "@/ui/primitives/button";

const IDLE: BookingSettingsState = { status: "idle" };

/** Sends the opposite of the stored state: a deactivated type leaves the public page, its bookings stay. */
export function ToggleEventTypeForm({ row }: { row: EventTypeRow }) {
  const [state, formAction, pending] = useActionState(setEventTypeActiveAction, IDLE);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="isActive" value={String(!row.isActive)} />
      <Button type="submit" variant="outline" disabled={pending}>
        {row.toggleLabel}
        <span className="sr-only"> le type {row.title}</span>
      </Button>
      <ActionFeedback feedback={toSettingsFeedback(state)} />
    </form>
  );
}
