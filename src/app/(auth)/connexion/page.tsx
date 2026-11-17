import type { Metadata } from "next";
import Link from "next/link";

import { isActivationPath } from "@/domain/nfc/activation-path";
import { SignInForm } from "@/ui/features/auth/sign-in-form";

export const metadata: Metadata = { title: "Connexion" };

type Props = { searchParams: Promise<{ suivant?: string | string[] }> };

/** Only a well-formed activation path is carried to the form; the sign-in action checks it again (decision 7). */
export default async function SignInPage({ searchParams }: Props) {
  const { suivant } = await searchParams;
  const returnPath = isActivationPath(suivant) ? suivant : undefined;
  return (
    <>
      <h1 className="text-2xl font-semibold">Connexion</h1>
      <SignInForm returnPath={returnPath} />
      <p>
        Pas encore de compte ?{" "}
        <Link href="/inscription" className="inline-flex min-h-11 items-center font-medium underline">
          Créer un compte
        </Link>
      </p>
    </>
  );
}
