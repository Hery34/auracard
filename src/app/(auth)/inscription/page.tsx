import type { Metadata } from "next";
import Link from "next/link";

import { RegisterForm } from "@/ui/features/auth/register-form";

export const metadata: Metadata = { title: "Inscription · carnet" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Créer un compte</h1>
      <RegisterForm />
      <p>
        Déjà inscrit ?{" "}
        <Link href="/connexion" className="inline-flex min-h-11 items-center font-medium underline">
          Se connecter
        </Link>
      </p>
    </>
  );
}
