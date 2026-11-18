"use client";

import { useActionState, useId, useRef } from "react";

import { deleteLeadAction, type DeleteLeadState } from "@/server/actions/lead";
import { DELETE_LEAD_CONFIRMATION_MESSAGE, DELETE_LEAD_ERROR_MESSAGES } from "@/ui/features/lead/messages";
import { Button } from "@/ui/primitives/button";

const INITIAL_STATE: DeleteLeadState = { status: "idle" };

/**
 * Deletion asks for an explicit confirmation in a native modal `<dialog>`: focus trapped and placed on « Annuler »
 * (first in the DOM), Échap closes it, focus returns to the opening button.
 */
export function DeleteLeadDialog({ leadId, senderName }: { leadId: string; senderName: string }) {
  const [state, formAction, pending] = useActionState(deleteLeadAction, INITIAL_STATE);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  const close = () => dialogRef.current?.close();

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" disabled={pending} onClick={() => dialogRef.current?.showModal()} className="self-start">
        Supprimer
        <span className="sr-only"> le message de {senderName}</span>
      </Button>
      {state.status === "error" && (
        <p role="alert" className="rounded-md border border-destructive bg-destructive/10 p-3 text-foreground">
          {DELETE_LEAD_ERROR_MESSAGES[state.error]}
        </p>
      )}
      <dialog
        ref={dialogRef}
        role="alertdialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-lg border border-border bg-card p-6 text-card-foreground backdrop:bg-black/70"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          Supprimer le message de {senderName} ?
        </h2>
        <p id={descriptionId} className="mt-2">
          {DELETE_LEAD_CONFIRMATION_MESSAGE}
        </p>
        <form action={formAction} onSubmit={close} className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <input type="hidden" name="leadId" value={leadId} />
          <Button type="button" variant="outline" onClick={close}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending}>
            Supprimer le message
          </Button>
        </form>
      </dialog>
    </div>
  );
}
