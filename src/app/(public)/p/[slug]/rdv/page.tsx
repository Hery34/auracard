import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import type { PublicBookingPage } from "@/domain/booking/ports";
import type { PublicProfile } from "@/domain/profile/profile";
import { createPublicContainer, turnstileSiteKey } from "@/server/container";
import { AudienceNotice } from "@/ui/features/analytics/audience-notice";
import { BookingFlow } from "@/ui/features/booking/booking-flow";

type Props = { params: Promise<{ slug: string }> };

/** No path at build time: each booking page is rendered on its first visit, then served statically (ISR). */
export function generateStaticParams(): { slug: string }[] {
  return [];
}

/** Unknown, unpublished or without any active type: the same 404. A failed read throws (never cached). */
const loadBookingPage = cache(async (slug: string): Promise<{ profile: PublicProfile; booking: PublicBookingPage }> => {
  const container = createPublicContainer();
  const [profile, booking] = await Promise.all([container.getPublicProfile(slug), container.getPublicBookingPage(slug)]);
  if (!profile.ok || (!booking.ok && booking.error === "unexpected")) {
    throw new Error("public booking page: read failed");
  }
  if (profile.value === null || !booking.ok) {
    notFound();
  }
  return { profile: profile.value, booking: booking.value };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { profile } = await loadBookingPage((await params).slug);
  return {
    title: `Prendre rendez-vous avec ${profile.displayName}`,
    robots: profile.isIndexable ? null : { index: false, follow: false },
  };
}

export default async function PublicBookingPage({ params }: Props) {
  const { profile, booking } = await loadBookingPage((await params).slug);
  return (
    <main data-theme="system" className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <a href={`/p/${profile.slug}`} className="inline-flex min-h-11 items-center self-start text-link underline underline-offset-4">
        Retour au profil
      </a>
      <h1 className="text-2xl font-semibold text-foreground">Prendre rendez-vous avec {profile.displayName}</h1>
      <BookingFlow
        slug={profile.slug}
        ownerName={profile.displayName}
        ownerTimeZone={booking.timeZone}
        eventTypes={booking.eventTypes}
        siteKey={turnstileSiteKey}
      />
      <AudienceNotice />
    </main>
  );
}
