import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createContainer } from "@/server/container";
import { SignOutButton } from "@/ui/features/auth/sign-out-button";

export const metadata: Metadata = { title: "Tableau de bord" };

/** Authentication is checked here, independently of `src/proxy.ts`, which only redirects for comfort. */
export default async function DashboardPage() {
  const { getOwnProfile } = await createContainer();
  const result = await getOwnProfile();
  if (!result.ok) {
    if (result.error === "unauthenticated") {
      redirect("/connexion");
    }
    throw new Error("dashboard: profile unavailable");
  }
  const { profile } = result.value;
  if (profile === null) {
    redirect("/connexion");
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Tableau de bord</h1>
      <dl className="flex flex-col gap-2">
        <div>
          <dt className="text-sm text-muted-foreground">Nom affiché</dt>
          <dd className="text-lg">{profile.displayName}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Adresse du profil</dt>
          <dd className="text-lg">{profile.slug}</dd>
        </div>
      </dl>
      <nav aria-label="Mon profil" className="flex flex-col gap-2">
        <Link href="/tableau-de-bord/profil" className="inline-flex min-h-11 items-center font-medium text-link underline underline-offset-4">
          Modifier mon profil
        </Link>
        <Link
          href={`/p/${profile.slug}`}
          prefetch={false}
          className="inline-flex min-h-11 items-center font-medium text-link underline underline-offset-4"
        >
          Voir ma page publique
        </Link>
        <Link href="/tableau-de-bord/puces" className="inline-flex min-h-11 items-center font-medium text-link underline underline-offset-4">
          Mes puces
        </Link>
        <Link href="/tableau-de-bord/qr" className="inline-flex min-h-11 items-center font-medium text-link underline underline-offset-4">
          Mon QR code
        </Link>
      </nav>
      <SignOutButton />
    </main>
  );
}
