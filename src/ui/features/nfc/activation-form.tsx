"use client";

import { useActionState } from "react";

import { ACTIVATION_CODE_INPUT_MAX_LENGTH } from "@/domain/nfc/nfc-tag";
import { activateNfcTagAction, type ActivateNfcTagState } from "@/server/actions/nfc";
import { ActivationError } from "@/ui/features/nfc/activation-error";
import { ACTIVATION_CODE_HINT, ACTIVATION_ERROR_MESSAGES } from "@/ui/features/nfc/messages";
import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";

const INITIAL_STATE: ActivateNfcTagState = { status: "idle" };

/** Only the refusals about the code are attached to the field; the others stay in the alert alone. */
function codeErrorOf(state: ActivateNfcTagState): string | undefined {
  return state.status === "error" && (state.error === "invalid" || state.error === "invalid_input")
    ? ACTIVATION_ERROR_MESSAGES[state.error]
    : undefined;
}

/** The uid travels in a hidden field; the action alone answers whether the code matches (no oracle on the page). */
export function ActivationForm({ uid }: { uid: string }) {
  const [state, formAction, pending] = useActionState(activateNfcTagAction, INITIAL_STATE);

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <ActivationError state={state} />
      <input type="hidden" name="uid" value={uid} />
      <Field
        name="code"
        label="Code d’activation"
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        required
        maxLength={ACTIVATION_CODE_INPUT_MAX_LENGTH}
        error={codeErrorOf(state)}
        hint={ACTIVATION_CODE_HINT}
        className="uppercase"
      />
      <Button type="submit" disabled={pending}>
        Activer
      </Button>
    </form>
  );
}
