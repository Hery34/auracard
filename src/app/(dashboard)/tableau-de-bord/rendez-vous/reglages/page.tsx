import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createContainer } from "@/server/container";
import { EventTypesSection } from "@/ui/features/booking/event-types-section";
import { ExceptionsSection } from "@/ui/features/booking/exceptions-section";
import { PHASE_1_CALENDAR_NOTICE } from "@/ui/features/booking/messages";
import { TimeZoneSection } from "@/ui/features/booking/time-zone-section";
import { WeeklyAvailabilitySection } from "@/ui/features/booking/weekly-availability-section";

export const metadata: Metadata = { title: "Réglages des rendez-vous" };

/**
 * Session checked here, independently of `src/proxy.ts`; every action checks it again.
 * Creation ids (idempotency keys) are drawn here, on each render: `revalidatePath` after a success brings new ones.
 */
export default async function BookingSettingsPage() {
  const { getBookingSettings } = await createContainer();
  const result = await getBookingSettings();
  if (!result.ok) {
    if (result.error === "unauthenticated" || result.error === "no_profile") {
      redirect("/connexion");
    }
    throw new Error("booking settings: unavailable");
  }
  const { timeZone, eventTypes, rules, exceptions } = result.value;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-8 px-4 py-8">
      <h1 className="text-2xl font-semibold">Réglages des rendez-vous</h1>
      <p className="rounded-lg border border-border bg-card p-4 text-card-foreground">{PHASE_1_CALENDAR_NOTICE}</p>
      <TimeZoneSection timeZone={timeZone} />
      <EventTypesSection eventTypes={eventTypes} newEventTypeId={crypto.randomUUID()} />
      <WeeklyAvailabilitySection rules={rules} />
      <ExceptionsSection exceptions={exceptions} timeZone={timeZone} newExceptionId={crypto.randomUUID()} />
      <Link href="/tableau-de-bord" className="inline-flex min-h-11 items-center font-medium text-link underline underline-offset-4">
        Retour au tableau de bord
      </Link>
    </main>
  );
}
