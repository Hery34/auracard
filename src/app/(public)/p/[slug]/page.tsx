import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import type { PublicProfile } from "@/domain/profile/profile";
import { createPublicContainer, turnstileSiteKey } from "@/server/container";
import { AudienceNotice } from "@/ui/features/analytics/audience-notice";
import { ProfileBeacon } from "@/ui/features/analytics/profile-beacon";
import { LeadSection } from "@/ui/features/lead/lead-section";
import { MEDIA_ORIGIN } from "@/ui/features/profile/media-origin";
import { ProfileCard } from "@/ui/features/profile/profile-card";
import { toProfileCardView } from "@/ui/features/profile/profile-card-view";
import { safeImageSrc } from "@/ui/features/profile/safe-image-src";

type Props = { params: Promise<{ slug: string }> };

/** No path at build time: each profile is rendered on its first visit, then served statically (ISR). */
export function generateStaticParams(): { slug: string }[] {
  return [];
}

// themeColor must stay equal to --background in globals.css, for each scheme.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FCFCFD" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0A0C" },
  ],
};

/** Unpublished and unknown slugs both end in `notFound()`: same 404, nothing to enumerate. */
const loadProfile = cache(async (slug: string): Promise<PublicProfile> => {
  const result = await createPublicContainer().getPublicProfile(slug);
  if (!result.ok) {
    throw new Error("public profile: read failed");
  }
  if (result.value === null) {
    notFound();
  }
  return result.value;
});

/** Defining `openGraph` here replaces the root one: without avatar, the brand image (`src/app/opengraph-image.png`) is restated. */
const DEFAULT_OPEN_GRAPH_IMAGE = { url: "/opengraph-image.png", width: 1200, height: 630, alt: "AuraCard" };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await loadProfile((await params).slug);
  const description = [profile.jobTitle, profile.company].filter((part) => part !== null).join(" · ");
  const avatar = safeImageSrc(profile.avatarUrl, MEDIA_ORIGIN);
  return {
    title: profile.displayName,
    ...(description === "" ? {} : { description }),
    robots: profile.isIndexable ? null : { index: false, follow: false },
    openGraph: {
      type: "profile",
      title: profile.displayName,
      ...(description === "" ? {} : { description }),
      images: [avatar === null ? DEFAULT_OPEN_GRAPH_IMAGE : { url: avatar, alt: profile.displayName }],
    },
  };
}

export default async function PublicProfilePage({ params }: Props) {
  const profile = await loadProfile((await params).slug);
  return (
    <main data-theme="system" className="mx-auto w-full max-w-md px-4 py-8">
      <ProfileCard view={toProfileCardView(profile, MEDIA_ORIGIN)} />
      {profile.acceptsLeads && <LeadSection slug={profile.slug} ownerName={profile.displayName} siteKey={turnstileSiteKey} />}
      <AudienceNotice />
      <ProfileBeacon slug={profile.slug} />
    </main>
  );
}
