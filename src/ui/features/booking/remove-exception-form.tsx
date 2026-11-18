"use client";

import { useActionState } from "react";

import { removeAvailabilityExceptionAction, type BookingSettingsState } from "@/server/booking/actions";
import { ActionFeedback } from "@/ui/features/booking/action-feedback";
import type { ExceptionRow } from "@/ui/features/booking/exception-row";
import { toSettingsFeedback } from "@/ui/features/booking/settings-feedback";
import { Button } from "@/ui/primitives/button";

const IDLE: BookingSettingsState = { status: "idle" };

export function RemoveExceptionForm({ row }: { row: ExceptionRow }) {
  const [state, formAction, pending] = useActionState(removeAvailabilityExceptionAction, IDLE);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={row.id} />
      <Button type="submit" variant="outline" disabled={pending} className="self-start">
        Supprimer
        <span className="sr-only">
          {" "}
          {row.kindLabel.toLowerCase()} {row.periodLabel}
        </span>
      </Button>
      <ActionFeedback feedback={toSettingsFeedback(state)} />
    </form>
  );
}
