import type { BeaconPayload } from "@/ui/features/analytics/beacon-payload";

const BEACON_PATH = "/api/beacon";

/** A failed measurement (missing API, exception) never reaches React. */
export function sendBeacon(payloadFor: (id: string) => BeaconPayload): void {
  try {
    navigator.sendBeacon(BEACON_PATH, JSON.stringify(payloadFor(crypto.randomUUID())));
  } catch {}
}
