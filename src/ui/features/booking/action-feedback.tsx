import { SAVED_MESSAGE } from "@/ui/features/booking/messages";
import type { SettingsFeedback } from "@/ui/features/booking/settings-feedback";

/** Success in a polite `role="status"`, refusal in a `role="alert"`; nothing before the first submission. */
export function ActionFeedback({ feedback }: { feedback: SettingsFeedback }) {
  if (feedback.saved) {
    return (
      <p role="status" className="text-sm text-foreground">
        {SAVED_MESSAGE}
      </p>
    );
  }
  if (feedback.alert === null) {
    return null;
  }
  return (
    <p role="alert" className="rounded-md border border-destructive bg-destructive/10 p-3 text-foreground">
      {feedback.alert}
    </p>
  );
}
