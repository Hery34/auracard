import type { DeleteAccountState } from "@/server/actions/account";
import { DELETE_ACCOUNT_ERROR_MESSAGES } from "@/ui/features/account/messages";

export function DeleteAccountError({ state }: { state: DeleteAccountState }) {
  if (state.status !== "error") {
    return null;
  }
  return (
    <p role="alert" className="rounded-md border border-destructive bg-destructive/10 p-3 text-foreground">
      {DELETE_ACCOUNT_ERROR_MESSAGES[state.error]}
    </p>
  );
}
