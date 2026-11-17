import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isNfcTagUid } from "@/domain/nfc/nfc-tag";
import { createContainer } from "@/server/container";
import { AppHeader } from "@/ui/features/app-shell/app-header";
import { ActivationForm } from "@/ui/features/nfc/activation-form";
import { SignInToActivate } from "@/ui/features/nfc/sign-in-to-activate";

type Props = { params: Promise<{ uid: string }> };

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Activer ma carte", robots: { index: false, follow: false } };

/** The state of the tag is never read here: only the activation action answers (decision 5). */
export default async function ActivateTagPage({ params }: Props) {
  const { uid } = await params;
  if (!isNfcTagUid(uid)) {
    notFound();
  }
  const { auth } = await createContainer();
  const user = await auth.currentUser();
  if (!user.ok) {
    throw new Error("activation: session unavailable");
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
        <h1 className="text-2xl font-semibold">Activer ma carte</h1>
        {user.value !== null ? <ActivationForm uid={uid} /> : <SignInToActivate uid={uid} />}
      </main>
    </>
  );
}
