import type { LocationKind } from "@/domain/booking/event-type";
import { parseHttpsUrl } from "@/domain/profile/https-url";

/** Audit 0037/0038: only a `video` location that is an absolute https: URL becomes a link; anything else stays text. */
export function videoLocationHref(kind: LocationKind, text: string | null): string | null {
  if (kind !== "video" || text === null) {
    return null;
  }
  const parsed = parseHttpsUrl(text);
  return parsed.ok ? parsed.value.value : null;
}
