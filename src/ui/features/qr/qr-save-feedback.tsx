import type { SaveQrStyleState } from "@/server/actions/qr";
import { SAVE_QR_STYLE_ERROR_MESSAGES, STYLE_SAVED_MESSAGE } from "@/ui/features/qr/messages";

/** Success in a polite live region kept in the DOM; failure in an alert. */
export function QrSaveFeedback({ state }: { state: SaveQrStyleState }) {
  return (
    <>
      <p role="status" className="text-sm text-foreground">
        {state.status === "saved" ? STYLE_SAVED_MESSAGE : ""}
      </p>
      {state.status === "error" && (
        <p role="alert" className="rounded-md border border-destructive bg-destructive/10 p-3 text-foreground">
          {SAVE_QR_STYLE_ERROR_MESSAGES[state.error]}
        </p>
      )}
    </>
  );
}
