import { parseTimeZone, type TimeZone } from "@/domain/booking/time-zone";

/**
 * The zones an owner may choose: `Intl.supportedValuesOf("timeZone")` of the running engine, read once. Narrower than
 * `pg_timezone_names`, which accepts names `Intl` refuses (note of 0036).
 */
const SELECTABLE: readonly string[] = Object.freeze(Intl.supportedValuesOf("timeZone"));
const SELECTABLE_SET: ReadonlySet<string> = new Set(SELECTABLE);

export function selectableTimeZones(): readonly string[] {
  return SELECTABLE;
}

/** A name of `selectableTimeZones()` that `parseTimeZone` also accepts; anything else → null. */
export function parseSelectableTimeZone(name: string): TimeZone | null {
  return SELECTABLE_SET.has(name) ? parseTimeZone(name) : null;
}
