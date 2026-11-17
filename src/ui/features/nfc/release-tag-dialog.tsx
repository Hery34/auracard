"use client";

import { useActionState, useId, useRef } from "react";

import { releaseNfcTagAction, type NfcTagActionState } from "@/server/actions/nfc";
import { RELEASE_CONFIRMATION_MESSAGE } from "@/ui/features/nfc/messages";
import { TagActionError } from "@/ui/features/nfc/tag-action-error";
import type { NfcTagRow } from "@/ui/features/nfc/tag-row";
import { Button } from "@/ui/primitives/button";

const INITIAL_STATE: NfcTagActionState = { status: "idle" };

/**
 * « Retirer de mon compte » asks for an explicit confirmation in a native modal `<dialog>`: focus trapped and
 * placed on « Annuler » (first in the DOM), Échap closes it, focus returns to the opening button.
 */
export function ReleaseTagDialog({ row }: { row: NfcTagRow }) {
  const [state, formAction, pending] = useActionState(releaseNfcTagAction, INITIAL_STATE);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  const close = () => dialogRef.current?.close();

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" disabled={pending} onClick={() => dialogRef.current?.showModal()}>
        Retirer de mon compte
        <span className="sr-only"> la carte se terminant par {row.shortId}</span>
      </Button>
      <TagActionError state={state} />
      <dialog
        ref={dialogRef}
        role="alertdialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-lg border border-border bg-card p-6 text-card-foreground backdrop:bg-black/70"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          Retirer la carte se terminant par {row.shortId} ?
        </h2>
        <p id={descriptionId} className="mt-2">
          {RELEASE_CONFIRMATION_MESSAGE}
        </p>
        <form action={formAction} onSubmit={close} className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <input type="hidden" name="tagId" value={row.id} />
          <Button type="button" variant="outline" onClick={close}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending}>
            Retirer la carte
          </Button>
        </form>
      </dialog>
    </div>
  );
}
