"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { registerAction, type ActionState } from "@/server/actions/auth";
import { ActionError } from "@/ui/features/auth/action-error";
import { DISPLAY_NAME_MAX_LENGTH, EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/server/actions/auth-limits";
import { fieldErrorsOf, REGISTER_FIELD_MESSAGES } from "@/ui/features/auth/messages";
import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";

const INITIAL_STATE: ActionState = { status: "idle" };

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerAction, INITIAL_STATE);
  const router = useRouter();
  const fieldErrors = fieldErrorsOf(state, REGISTER_FIELD_MESSAGES);

  useEffect(() => {
    if (state.status === "check_email") {
      router.push("/verifier-email");
    }
  }, [state, router]);

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <ActionError state={state} />
      <Field name="email" label="Adresse e-mail" type="email" autoComplete="email" required maxLength={EMAIL_MAX_LENGTH} error={fieldErrors.email} />
      <Field
        name="password"
        label="Mot de passe"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        error={fieldErrors.password}
      />
      <Field name="displayName" label="Nom affiché" type="text" autoComplete="name" required maxLength={DISPLAY_NAME_MAX_LENGTH} error={fieldErrors.displayName} />
      <Button type="submit" disabled={pending}>
        Créer mon compte
      </Button>
    </form>
  );
}
