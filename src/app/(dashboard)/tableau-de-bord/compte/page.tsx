import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createContainer } from "@/server/container";
import { DeleteAccountForm } from "@/ui/features/account/delete-account-form";

export const metadata: Metadata = { title: "Mon compte" };

/** Session checked here, independently of `src/proxy.ts`; the action checks it again (decision 3). */
export default async function MyAccountPage() {
  const { auth } = await createContainer();
  const user = await auth.currentUser();
  if (!user.ok) {
    throw new Error("my account: session unavailable");
  }
  if (user.value === null) {
    redirect("/connexion");
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Mon compte</h1>
      <section aria-labelledby="delete-account-title" className="flex flex-col gap-4">
        <h2 id="delete-account-title" className="text-xl font-semibold">
          Supprimer mon compte
        </h2>
        <p>
          La suppression est immédiate et définitive : votre profil, vos liens, vos images et votre QR code sont effacés,
          vos cartes sont détachées de votre compte. Cette action ne peut pas être annulée.
        </p>
        <p>Votre compte de connexion est aussi supprimé, sauf s’il sert encore à d’autres services.</p>
        <DeleteAccountForm />
      </section>
      <Link href="/tableau-de-bord" className="inline-flex min-h-11 items-center font-medium text-link underline underline-offset-4">
        Retour au tableau de bord
      </Link>
    </main>
  );
}
