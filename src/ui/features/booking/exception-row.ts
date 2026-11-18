import type { AvailabilityException } from "@/domain/booking/availability";
import { EXCEPTION_KIND_LABELS } from "@/ui/features/booking/messages";

export type ExceptionRow = { id: string; kindLabel: string; periodLabel: string };

/** Stored instants (ISO UTC) shown at the wall-clock time of the profile's zone. */
export function toExceptionRows(exceptions: readonly AvailabilityException[], timeZone: string): ExceptionRow[] {
  const format = new Intl.DateTimeFormat("fr-FR", { timeZone, dateStyle: "full", timeStyle: "short" });
  return exceptions.map(({ id, kind, startsAt, endsAt }) => ({
    id,
    kindLabel: EXCEPTION_KIND_LABELS[kind],
    periodLabel: format.formatRange(new Date(startsAt), new Date(endsAt)),
  }));
}
