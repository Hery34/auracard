"use client";

import { useEffect, useRef } from "react";

import type { AnalyticsSource } from "@/domain/analytics/analytics-event";
import { beaconTargetOf } from "@/ui/features/analytics/beacon-target";
import {
  clickPayload,
  sourceOf,
  viewPayload,
  withoutSource,
  type BeaconPayload,
} from "@/ui/features/analytics/beacon-payload";

const BEACON_PATH = "/api/beacon";

/** A failed measurement (missing API, exception) never reaches React. */
function send(payloadFor: (id: string) => BeaconPayload): void {
  try {
    navigator.sendBeacon(BEACON_PATH, JSON.stringify(payloadFor(crypto.randomUUID())));
  } catch {}
}

/** Reads `?s=` once, removes it from the address bar, then counts the visit. No cookie, no storage. */
function startVisit(slug: string): AnalyticsSource {
  const url = new URL(window.location.href);
  const source = sourceOf(url);
  const cleaned = withoutSource(url);
  if (cleaned !== null) {
    try {
      window.history.replaceState(null, "", cleaned);
    } catch {}
  }
  send((id) => viewPayload(slug, id, source));
  return source;
}

/**
 * One `profile_view` per mount, then a `link_click` / `contact_click` per click on a marked control.
 * Untrusted clicks (the one `ContactReveal` replays on the revealed anchor) are not counted twice.
 */
export function useProfileBeacon(slug: string): void {
  const source = useRef<AnalyticsSource | null>(null);

  useEffect(() => {
    source.current ??= startVisit(slug);
    const visitSource = source.current;

    function onClick(event: MouseEvent) {
      if (!event.isTrusted || !(event.target instanceof Element)) {
        return;
      }
      const target = beaconTargetOf(event.target);
      if (target !== null) {
        send((id) => clickPayload(slug, id, visitSource, target));
      }
    }

    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [slug]);
}
