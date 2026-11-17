import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createContainer } from "@/server/container";
import { NfcTagList } from "@/ui/features/nfc/nfc-tag-list";
import { toNfcTagRow } from "@/ui/features/nfc/tag-row";

export const metadata: Metadata = { title: "Mes puces" };

/** Session checked here, independently of `src/proxy.ts`; RLS restricts the list to the caller's tags. */
export default async function MyTagsPage() {
  const { listOwnNfcTags } = await createContainer();
  const result = await listOwnNfcTags();
  if (!result.ok) {
    if (result.error === "unauthenticated") {
      redirect("/connexion");
    }
    throw new Error("my tags: list unavailable");
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Mes puces</h1>
      <NfcTagList rows={result.value.map(toNfcTagRow)} />
      <Link href="/tableau-de-bord" className="inline-flex min-h-11 items-center font-medium text-link underline underline-offset-4">
        Retour au tableau de bord
      </Link>
    </main>
  );
}
