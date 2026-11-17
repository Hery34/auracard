import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import type { PublicProfile } from "@/domain/profile/profile";
import { createPublicContainer } from "@/server/container";
import { ProfileCard } from "@/ui/features/profile/profile-card";
import { toProfileCardView } from "@/ui/features/profile/profile-card-view";
import { safeHttpsHref } from "@/ui/features/profile/safe-href";

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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await loadProfile((await params).slug);
  const description = [profile.jobTitle, profile.company].filter((part) => part !== null).join(" · ");
  const avatar = safeHttpsHref(profile.avatarUrl);
  return {
    title: profile.displayName,
    ...(description === "" ? {} : { description }),
    robots: profile.isIndexable ? null : { index: false, follow: false },
    openGraph: {
      type: "profile",
      title: profile.displayName,
      ...(description === "" ? {} : { description }),
      ...(avatar === null ? {} : { images: [{ url: avatar.href, alt: profile.displayName }] }),
    },
  };
}

export default async function PublicProfilePage({ params }: Props) {
  const profile = await loadProfile((await params).slug);
  return (
    <main data-theme="system" className="mx-auto w-full max-w-md px-4 py-8">
      <ProfileCard view={toProfileCardView(profile)} />
    </main>
  );
}
