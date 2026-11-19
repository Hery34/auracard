"use client";

import { useActionState, useId, useRef } from "react";

import { deleteEventTypeAction, type BookingSettingsState } from "@/server/booking/actions";
import { ActionFeedback } from "@/ui/features/booking/action-feedback";
import type { EventTypeRow } from "@/ui/features/booking/event-type-row";
import { DELETE_EVENT_TYPE_CONFIRMATION } from "@/ui/features/booking/messages";
import { toSettingsFeedback } from "@/ui/features/booking/settings-feedback";
import { Button } from "@/ui/primitives/button";

const IDLE: BookingSettingsState = { status: "idle" };

/**
 * Confirmation in a native modal `<dialog>` (focus trapped, Échap closes it). A type with bookings is refused
 * (`has_bookings`): the alert, outside the dialog, invites to deactivate it instead.
 */
export function DeleteEventTypeDialog({ row }: { row: EventTypeRow }) {
  const [state, formAction, pending] = useActionState(deleteEventTypeAction, IDLE);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  const close = () => dialogRef.current?.close();

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" disabled={pending} onClick={() => dialogRef.current?.showModal()}>
        Supprimer<span className="sr-only"> le type {row.title}</span>
      </Button>
      <ActionFeedback feedback={toSettingsFeedback(state)} />
      <dialog
        ref={dialogRef}
        role="alertdialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-lg border border-border bg-card p-6 text-card-foreground backdrop:bg-black/70"
      >
        <h3 id={titleId} className="text-lg font-semibold">
          Supprimer le type « {row.title} » ?
        </h3>
        <p id={descriptionId} className="mt-2">
          {DELETE_EVENT_TYPE_CONFIRMATION}
        </p>
        <form action={formAction} onSubmit={close} className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <input type="hidden" name="id" value={row.id} />
          <Button type="button" variant="outline" onClick={close}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending}>
            Supprimer le type
          </Button>
        </form>
      </dialog>
    </div>
  );
}
