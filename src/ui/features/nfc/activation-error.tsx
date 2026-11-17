import Link from "next/link";

import type { ActivateNfcTagState } from "@/server/actions/nfc";
import { ACTIVATION_ERROR_MESSAGES } from "@/ui/features/nfc/messages";

/** Refusal of the activation, announced by `role="alert"`; `no_profile` points to the profile editor. */
export function ActivationError({ state }: { state: ActivateNfcTagState }) {
  if (state.status !== "error") {
    return null;
  }
  return (
    <div role="alert" className="rounded-md border border-destructive bg-destructive/10 p-3 text-foreground">
      {ACTIVATION_ERROR_MESSAGES[state.error]}
      {state.error === "no_profile" && (
        <>
          {" "}
          <Link href="/tableau-de-bord/profil" className="inline-flex min-h-11 items-center font-medium underline">
            Créer mon profil
          </Link>
        </>
      )}
    </div>
  );
}
