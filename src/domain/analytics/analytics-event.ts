import { err, ok, type Result } from "@/domain/shared/result";

/** Same lists as the checks of `carnet.analytics_events` (0028). */
export const ANALYTICS_EVENT_TYPES = [
  "profile_view",
  "nfc_scan",
  "qr_scan",
  "vcard_download",
  "link_click",
  "contact_click",
  "lead_submitted",
] as const;
export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export const ANALYTICS_SOURCES = ["nfc", "qr", "direct"] as const;
export type AnalyticsSource = (typeof ANALYTICS_SOURCES)[number];

export const DEVICE_CLASSES = ["mobile", "desktop"] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

/** Sent by the public page. */
export const BEACON_EVENT_TYPES = ["profile_view", "link_click", "contact_click"] as const;
export type BeaconEventType = (typeof BEACON_EVENT_TYPES)[number];

/** Written by the routes `/t`, `/q` and `/v`. */
export const SERVER_EVENT_TYPES = ["nfc_scan", "qr_scan", "vcard_download"] as const;
export type ServerEventType = (typeof SERVER_EVENT_TYPES)[number];

/** The profile is designated by its slug; the database resolves it among published profiles. */
export type AnalyticsEvent = {
  id: string;
  slug: string;
  type: AnalyticsEventType;
  source: AnalyticsSource;
  linkId: string | null;
  deviceClass: DeviceClass;
};

/** Length of a uuid in its canonical text form (8-4-4-4-12). */
export const UUID_LENGTH = 36;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV4(value: string): boolean {
  return UUID_V4_PATTERN.test(value);
}

function includes<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value);
}

export function sourceFromQuery(value: string | null): AnalyticsSource {
  return value === "nfc" || value === "qr" ? value : "direct";
}

const SOURCE_OF_SERVER_EVENT: Readonly<Record<ServerEventType, AnalyticsSource>> = {
  nfc_scan: "nfc",
  qr_scan: "qr",
  vcard_download: "direct",
};

export function sourceOfServerEvent(type: ServerEventType): AnalyticsSource {
  return SOURCE_OF_SERVER_EVENT[type];
}

export type BeaconEventDraft = { id: string; type: string; source: string; linkId: string | null };

export type ValidBeaconEvent = { id: string; type: BeaconEventType; source: AnalyticsSource; linkId: string | null };

/** Ids in lower case: one row per event whatever the case sent. Only `link_click` carries a link. */
export function parseBeaconEvent(draft: BeaconEventDraft): Result<ValidBeaconEvent, "invalid_event"> {
  const { id, type, source, linkId } = draft;
  if (!isUuidV4(id) || !includes(BEACON_EVENT_TYPES, type) || !includes(ANALYTICS_SOURCES, source)) {
    return err("invalid_event");
  }
  if (type === "link_click") {
    if (linkId === null || !UUID_PATTERN.test(linkId)) {
      return err("invalid_event");
    }
    return ok({ id: id.toLowerCase(), type, source, linkId: linkId.toLowerCase() });
  }
  if (linkId !== null) {
    return err("invalid_event");
  }
  return ok({ id: id.toLowerCase(), type, source, linkId: null });
}
