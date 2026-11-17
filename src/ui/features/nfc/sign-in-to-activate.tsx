import Link from "next/link";

import { signInToActivatePath } from "@/domain/nfc/activation-path";
import { CONFIRM_EMAIL_THEN_TAP_AGAIN, SIGN_IN_TO_ACTIVATE_MESSAGE } from "@/ui/features/nfc/messages";

const LINK_CLASS = "inline-flex min-h-11 items-center font-medium text-link underline underline-offset-4";

/** Visitor without a session: the sign-in link brings them back to this activation page. */
export function SignInToActivate({ uid }: { uid: string }) {
  return (
    <div className="flex flex-col gap-4">
      <p>{SIGN_IN_TO_ACTIVATE_MESSAGE}</p>
      <nav aria-label="Compte" className="flex flex-col gap-2">
        <Link href={signInToActivatePath(uid)} prefetch={false} className={LINK_CLASS}>
          Se connecter
        </Link>
        <Link href="/inscription" prefetch={false} className={LINK_CLASS}>
          Créer un compte
        </Link>
      </nav>
      <p className="text-sm text-muted-foreground">{CONFIRM_EMAIL_THEN_TAP_AGAIN}</p>
    </div>
  );
}
