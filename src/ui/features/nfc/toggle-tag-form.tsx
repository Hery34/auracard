"use client";

import { useActionState } from "react";

import { setNfcTagEnabledAction, type NfcTagActionState } from "@/server/actions/nfc";
import { TagActionError } from "@/ui/features/nfc/tag-action-error";
import type { NfcTagRow } from "@/ui/features/nfc/tag-row";
import { Button } from "@/ui/primitives/button";

const INITIAL_STATE: NfcTagActionState = { status: "idle" };

/** Sends the opposite of the current state: « Désactiver » an active tag, « Réactiver » a disabled one. */
export function ToggleTagForm({ row }: { row: NfcTagRow }) {
  const [state, formAction, pending] = useActionState(setNfcTagEnabledAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tagId" value={row.id} />
      <input type="hidden" name="enabled" value={String(!row.enabled)} />
      <Button type="submit" variant="outline" disabled={pending}>
        {row.toggleLabel}
        <span className="sr-only"> la carte se terminant par {row.shortId}</span>
      </Button>
      <TagActionError state={state} />
    </form>
  );
}
