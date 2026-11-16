import type { Metadata } from "next";
import Link from "next/link";

import { SignInForm } from "@/ui/features/auth/sign-in-form";

export const metadata: Metadata = { title: "Connexion" };

export default function SignInPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Connexion</h1>
      <SignInForm />
      <p>
        Pas encore de compte ?{" "}
        <Link href="/inscription" className="inline-flex min-h-11 items-center font-medium underline">
          Créer un compte
        </Link>
      </p>
    </>
  );
}
