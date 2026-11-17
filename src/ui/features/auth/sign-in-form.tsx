"use client";

import { useActionState } from "react";

import { signInAction, type ActionState } from "@/server/actions/auth";
import { ActionError } from "@/ui/features/auth/action-error";
import { DISPLAY_NAME_MAX_LENGTH, EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH } from "@/server/actions/auth-limits";
import { fieldErrorsOf, SIGN_IN_FIELD_MESSAGES } from "@/ui/features/auth/messages";
import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";

const INITIAL_STATE: ActionState = { status: "idle" };

/**
 * The display name is asked only when the account has to join AuraCard (`display_name_required`).
 * `returnPath` (an activation page) travels in the hidden field `suivant`.
 */
export function SignInForm({ returnPath }: { returnPath?: string | undefined }) {
  const [state, formAction, pending] = useActionState(signInAction, INITIAL_STATE);
  const fieldErrors = fieldErrorsOf(state, SIGN_IN_FIELD_MESSAGES);
  const asksDisplayName = fieldErrors.displayName !== undefined;

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <ActionError state={state} />
      {returnPath !== undefined && <input type="hidden" name="suivant" value={returnPath} />}
      <Field name="email" label="Adresse e-mail" type="email" autoComplete="email" required maxLength={EMAIL_MAX_LENGTH} error={fieldErrors.email} />
      <Field
        name="password"
        label="Mot de passe"
        type="password"
        autoComplete="current-password"
        required
        maxLength={PASSWORD_MAX_LENGTH}
        error={fieldErrors.password}
      />
      {asksDisplayName && (
        <Field name="displayName" label="Nom affiché" type="text" autoComplete="name" maxLength={DISPLAY_NAME_MAX_LENGTH} error={fieldErrors.displayName} />
      )}
      <Button type="submit" disabled={pending}>
        Se connecter
      </Button>
    </form>
  );
}
