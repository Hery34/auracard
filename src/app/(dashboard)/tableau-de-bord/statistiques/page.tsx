import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createContainer } from "@/server/container";
import { PeriodNav } from "@/ui/features/stats/period-nav";
import { StatsReport } from "@/ui/features/stats/stats-report";
import { periodFromSearchParam, periodOptions, STATS_NOTICE, toStatsView } from "@/ui/features/stats/stats-view";

export const metadata: Metadata = { title: "Mes statistiques" };

/** Session checked here, independently of `src/proxy.ts`; read through the session client under RLS (0030, decision 4). */
export default async function MyStatsPage({ searchParams }: { searchParams: Promise<{ periode?: string | string[] }> }) {
  const period = periodFromSearchParam((await searchParams).periode);
  const { getOwnStats } = await createContainer();
  const result = await getOwnStats({ period });
  if (!result.ok) {
    if (result.error === "unauthenticated" || result.error === "no_profile") {
      redirect("/connexion");
    }
    throw new Error("my stats: unavailable");
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Mes statistiques</h1>
      <PeriodNav options={periodOptions(period)} />
      <StatsReport view={toStatsView(result.value)} />
      <p className="text-sm text-muted-foreground">{STATS_NOTICE}</p>
      <Link href="/tableau-de-bord" className="inline-flex min-h-11 items-center font-medium text-link underline underline-offset-4">
        Retour au tableau de bord
      </Link>
    </main>
  );
}
