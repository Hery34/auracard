import type { EventType, EventTypeDraft } from "@/domain/booking/event-type";
import { LOCATION_KIND_LABELS } from "@/ui/features/booking/messages";

export type EventTypeRow = {
  id: string;
  title: string;
  durationLabel: string;
  detailsLabel: string;
  locationLabel: string;
  isActive: boolean;
  statusLabel: "Actif" | "Désactivé";
  toggleLabel: "Désactiver" | "Réactiver";
  /** `ids` field of « Monter » / « Descendre »; `null` at the top / bottom of the list. */
  orderIfUp: string | null;
  orderIfDown: string | null;
  draft: EventTypeDraft;
};

function minutes(value: number): string {
  return `${value} min`;
}

/** The full order with the item at `index` swapped with its neighbour at `index + offset`. */
function swapped(ids: readonly string[], index: number, offset: -1 | 1): string | null {
  const other = index + offset;
  if (other < 0 || other >= ids.length) {
    return null;
  }
  const order = [...ids];
  [order[index], order[other]] = [order[other] ?? "", order[index] ?? ""];
  return JSON.stringify(order);
}

/** `types` ordered by position, as `getBookingSettings` returns them. */
export function toEventTypeRows(types: readonly EventType[]): EventTypeRow[] {
  const ids = types.map((type) => type.id);
  return types.map(({ id, isActive, title, durationMin, bufferMin, minNoticeMin, locationKind, locationText }, index) => ({
    id,
    title,
    durationLabel: minutes(durationMin),
    detailsLabel: `Tampon ${minutes(bufferMin)} · Délai minimal ${minutes(minNoticeMin)}`,
    locationLabel:
      locationText === null ? LOCATION_KIND_LABELS[locationKind] : `${LOCATION_KIND_LABELS[locationKind]} · ${locationText}`,
    isActive,
    statusLabel: isActive ? "Actif" : "Désactivé",
    toggleLabel: isActive ? "Désactiver" : "Réactiver",
    orderIfUp: swapped(ids, index, -1),
    orderIfDown: swapped(ids, index, 1),
    draft: { title, durationMin, bufferMin, minNoticeMin, locationKind, locationText },
  }));
}
