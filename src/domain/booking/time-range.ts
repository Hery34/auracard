/** Half-open range of instants [start, end), as tstzrange '[)' in carnet. */
export type TimeRange = { readonly start: Temporal.Instant; readonly end: Temporal.Instant };

export function timeRange(start: Temporal.Instant, end: Temporal.Instant): TimeRange | null {
  return Temporal.Instant.compare(start, end) < 0 ? { start, end } : null;
}

/** PostgreSQL `&&` on '[)' ranges: contiguity is not an overlap. */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return Temporal.Instant.compare(a.start, b.end) < 0 && Temporal.Instant.compare(b.start, a.end) < 0;
}

/** PostgreSQL `@>` on '[)' ranges. */
export function contains(outer: TimeRange, inner: TimeRange): boolean {
  return Temporal.Instant.compare(outer.start, inner.start) <= 0 && Temporal.Instant.compare(inner.end, outer.end) <= 0;
}
