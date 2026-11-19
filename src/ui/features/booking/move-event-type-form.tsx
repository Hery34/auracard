"use client";

import { useActionState } from "react";

import { reorderEventTypesAction, type BookingSettingsState } from "@/server/booking/actions";
import { ActionFeedback } from "@/ui/features/booking/action-feedback";
import type { EventTypeRow } from "@/ui/features/booking/event-type-row";
import { toSettingsFeedback } from "@/ui/features/booking/settings-feedback";
import { Button } from "@/ui/primitives/button";

const IDLE: BookingSettingsState = { status: "idle" };

/** Each button sends the whole new order (`ids`); absent at the top / bottom of the list. */
export function MoveEventTypeForm({ row }: { row: EventTypeRow }) {
  const [state, formAction, pending] = useActionState(reorderEventTypesAction, IDLE);
  if (row.orderIfUp === null && row.orderIfDown === null) {
    return null;
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        {row.orderIfUp !== null && (
          <Button type="submit" variant="outline" name="ids" value={row.orderIfUp} disabled={pending}>
            Monter<span className="sr-only"> le type {row.title}</span>
          </Button>
        )}
        {row.orderIfDown !== null && (
          <Button type="submit" variant="outline" name="ids" value={row.orderIfDown} disabled={pending}>
            Descendre<span className="sr-only"> le type {row.title}</span>
          </Button>
        )}
      </div>
      <ActionFeedback feedback={toSettingsFeedback(state)} />
    </form>
  );
}
