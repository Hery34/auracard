/** IANA identifier known to Temporal, in its exact canonical case (as carnet.is_valid_time_zone requires). */
export type TimeZone = string & { readonly __brand: "TimeZone" };

/** End of a local day as written in rules: 00:00 of the next day. */
export const END_OF_DAY = "24:00";

const UTC_OFFSET = /^[+-]/;

export function parseTimeZone(value: string): TimeZone | null {
  if (UTC_OFFSET.test(value)) {
    return null;
  }
  try {
    const known = Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(value).timeZoneId;
    return known === value ? (value as TimeZone) : null;
  } catch {
    return null;
  }
}

/**
 * Local date + "HH:MM" (`END_OF_DAY` = 00:00 of the next day) → instant, as `(date + time) at time zone zone` in PostgreSQL:
 * a nonexistent time is read with the offset before the transition, an ambiguous one with the offset after it,
 * which is Temporal `disambiguation: "later"` in both cases.
 */
export function wallClockToInstant(date: Temporal.PlainDate, time: string, zone: TimeZone): Temporal.Instant {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const local = time === END_OF_DAY ? date.add({ days: 1 }).toPlainDateTime() : date.toPlainDateTime({ hour, minute });
  return local.toZonedDateTime(zone, { disambiguation: "later" }).toInstant();
}
