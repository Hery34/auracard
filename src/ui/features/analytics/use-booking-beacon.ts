"use client";

import { useCallback, useEffect, useRef } from "react";

import { bookingPayload } from "@/ui/features/analytics/beacon-payload";
import { sendBeacon } from "@/ui/features/analytics/send-beacon";

/** One `booking_viewed` per mount; `markStarted` sends `booking_started` once per page (0039, decision 4). */
export function useBookingBeacon(slug: string): { markStarted: () => void } {
  const viewed = useRef(false);
  const started = useRef(false);

  useEffect(() => {
    if (!viewed.current) {
      viewed.current = true;
      sendBeacon((id) => bookingPayload(slug, id, "booking_viewed"));
    }
  }, [slug]);

  const markStarted = useCallback(() => {
    if (!started.current) {
      started.current = true;
      sendBeacon((id) => bookingPayload(slug, id, "booking_started"));
    }
  }, [slug]);

  return { markStarted };
}
