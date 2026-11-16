import Link from "next/link";

import type { ActionState } from "@/server/actions/auth";
import { FORM_ERROR_MESSAGES, formErrorOf } from "@/ui/features/auth/messages";

/** Form-level error, announced by `role="alert"`; field-level errors are rendered by `Field`. */
export function ActionError({ state }: { state: ActionState }) {
  const error = formErrorOf(state);
  if (error === null) {
    return null;
  }
  return (
    <div role="alert" className="rounded-md border border-red-700 bg-red-50 p-3 text-red-800">
      {FORM_ERROR_MESSAGES[error]}
      {error === "email_taken" && (
        <>
          {" "}
          <Link href="/connexion" className="inline-flex min-h-11 items-center font-medium underline">
            Se connecter
          </Link>
        </>
      )}
    </div>
  );
}
