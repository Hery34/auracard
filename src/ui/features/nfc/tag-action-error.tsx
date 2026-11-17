import type { NfcTagActionState } from "@/server/actions/nfc";
import { TAG_ACTION_ERROR_MESSAGES } from "@/ui/features/nfc/messages";

/** Failure of an action on one tag, announced by `role="alert"` inside its row. */
export function TagActionError({ state }: { state: NfcTagActionState }) {
  if (state.status !== "error") {
    return null;
  }
  return (
    <p role="alert" className="rounded-md border border-destructive bg-destructive/10 p-3 text-foreground">
      {TAG_ACTION_ERROR_MESSAGES[state.error]}
    </p>
  );
}
