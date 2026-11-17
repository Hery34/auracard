import { FORM_ERROR_MESSAGES, PROFILE_KEPT_MESSAGE, SAVED_MESSAGE } from "@/ui/features/profile-editor/messages";
import type { SaveOutcome } from "@/ui/features/profile-editor/use-profile-editor";

/** Success in a polite live region kept in the DOM; failure in an alert. */
export function SaveFeedback({ outcome }: { outcome: SaveOutcome }) {
  return (
    <>
      <p role="status" className="text-sm text-foreground">
        {outcome.status === "saved" ? SAVED_MESSAGE : ""}
      </p>
      {outcome.status === "error" && (
        <div role="alert" className="rounded-md border border-destructive bg-destructive/10 p-3 text-foreground">
          {FORM_ERROR_MESSAGES[outcome.error]}
          {outcome.profileKept && ` ${PROFILE_KEPT_MESSAGE}`}
        </div>
      )}
    </>
  );
}
