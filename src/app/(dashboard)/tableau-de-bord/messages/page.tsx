import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createContainer } from "@/server/container";
import { LeadList } from "@/ui/features/lead/lead-list";
import { olderLeadsHref, toLeadItem } from "@/ui/features/lead/lead-item";
import { OLDER_LEADS_LABEL } from "@/ui/features/lead/messages";

export const metadata: Metadata = { title: "Mes messages" };

const LINK_CLASS = "inline-flex min-h-11 items-center font-medium text-link underline underline-offset-4";

/** Session checked here, independently of `src/proxy.ts`; read through the session client under RLS (decision 5). */
export default async function MyLeadsPage({ searchParams }: { searchParams: Promise<{ avant?: string | string[] }> }) {
  const { avant } = await searchParams;
  const { listOwnLeads } = await createContainer();
  const result = await listOwnLeads({ before: typeof avant === "string" ? avant : null });
  if (!result.ok) {
    if (result.error === "unauthenticated" || result.error === "no_profile") {
      redirect("/connexion");
    }
    throw new Error("my leads: unavailable");
  }
  const older = olderLeadsHref(result.value.older);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Mes messages</h1>
      <LeadList items={result.value.leads.map(toLeadItem)} />
      {older !== null && (
        <Link href={older} className={LINK_CLASS}>
          {OLDER_LEADS_LABEL}
        </Link>
      )}
      <Link href="/tableau-de-bord" className={LINK_CLASS}>
        Retour au tableau de bord
      </Link>
    </main>
  );
}
