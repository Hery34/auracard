"use client";

import { useActionState } from "react";

import { ACCOUNT_DELETION_CONFIRMATION } from "@/domain/account/account-deletion";
import { deleteAccountAction, type DeleteAccountState } from "@/server/actions/account";
import { DeleteAccountError } from "@/ui/features/account/delete-account-error";
import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";

const INITIAL_STATE: DeleteAccountState = { status: "idle" };

/** The confirmation word is checked by the action only (decision 1, criterion 4). */
export function DeleteAccountForm() {
  const [state, formAction, pending] = useActionState(deleteAccountAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field
        name="confirmation"
        label={`Pour confirmer, saisissez ${ACCOUNT_DELETION_CONFIRMATION}`}
        type="text"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        required
      />
      <Button type="submit" disabled={pending}>
        Supprimer mon compte
      </Button>
      <DeleteAccountError state={state} />
    </form>
  );
}
