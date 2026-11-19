import type { PublicEventType } from "@/domain/booking/ports";
import { LOCATION_KIND_LABELS } from "@/ui/features/booking/messages";
import type { RadioCardOption } from "@/ui/primitives/radio-card-group";

/** Title first (the accessible name starts with it), then duration, mode and the address of an in_person type. */
export function eventTypeOptions(eventTypes: readonly PublicEventType[]): RadioCardOption[] {
  return eventTypes.map((type) => ({
    value: type.id,
    label: type.title,
    description: [`${type.durationMin} min`, LOCATION_KIND_LABELS[type.locationKind], type.locationText]
      .filter((part) => part !== null)
      .join(" · "),
  }));
}
