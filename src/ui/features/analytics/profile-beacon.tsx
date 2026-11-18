"use client";

import { useProfileBeacon } from "@/ui/features/analytics/use-profile-beacon";

/** Audience measurement of the public page (0029, decision 5): renders nothing, never delays the static HTML. */
export function ProfileBeacon({ slug }: { slug: string }) {
  useProfileBeacon(slug);
  return null;
}
