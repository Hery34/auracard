import { sourceFromQuery, type AnalyticsSource, type BeaconEventType } from "@/domain/analytics/analytics-event";
import type { BeaconTarget } from "@/ui/features/analytics/beacon-target";

/** JSON accepted by `POST /api/beacon`. */
export type BeaconPayload = {
  slug: string;
  id: string;
  type: BeaconEventType;
  source: AnalyticsSource;
  link_id?: string;
};

export const SOURCE_PARAMETER = "s";

export function sourceOf(url: URL): AnalyticsSource {
  return sourceFromQuery(url.searchParams.get(SOURCE_PARAMETER));
}

/** The same URL without `?s=`, or null when there is nothing to remove. */
export function withoutSource(url: URL): string | null {
  if (!url.searchParams.has(SOURCE_PARAMETER)) {
    return null;
  }
  const cleaned = new URL(url);
  cleaned.searchParams.delete(SOURCE_PARAMETER);
  return `${cleaned.pathname}${cleaned.search}${cleaned.hash}`;
}

export function viewPayload(slug: string, id: string, source: AnalyticsSource): BeaconPayload {
  return { slug, id, type: "profile_view", source };
}

/** The booking page counts its visits as `direct` (0039, decision 7). */
export function bookingPayload(slug: string, id: string, type: "booking_viewed" | "booking_started"): BeaconPayload {
  return { slug, id, type, source: "direct" };
}

export function clickPayload(slug: string, id: string, source: AnalyticsSource, target: BeaconTarget): BeaconPayload {
  return target.kind === "link"
    ? { slug, id, type: "link_click", source, link_id: target.linkId }
    : { slug, id, type: "contact_click", source };
}
