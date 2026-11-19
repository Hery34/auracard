import { END_OF_DAY, wallClockToInstant, type TimeZone } from "@/domain/booking/time-zone";
import { err, ok, type Result } from "@/domain/shared/result";

/** ISO: 1 = Monday … 7 = Sunday. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Weekday = (typeof WEEKDAYS)[number];
/** Trigger `availability_rules_limit`. */
export const MAX_AVAILABILITY_RULES = 50;
/** `availability_rules_min_length_check`. */
export const MIN_RULE_MINUTES = 5;
/** Trigger `availability_exceptions_limit`. */
export const MAX_UPCOMING_EXCEPTIONS = 200;
export const EXCEPTION_KINDS = ["busy", "extra"] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

/** Local times of the profile's time zone, "HH:MM"; an end may be `END_OF_DAY`. */
export type AvailabilityRule = { weekday: Weekday; start: string; end: string };
export type RuleIssueReason = "invalid_weekday" | "invalid_time" | "invalid_order" | "too_short" | "overlap";
export type RuleIssue = { index: number; reason: RuleIssueReason };

/** Instants in ISO 8601 UTC with milliseconds, `[startsAt, endsAt)`. */
export type AvailabilityException = { id: string; kind: ExceptionKind; startsAt: string; endsAt: string };
export type NewExceptionRange = Omit<AvailabilityException, "id">;
export type ExceptionError = "invalid_kind" | "invalid_start" | "invalid_end" | "invalid_range" | "already_ended";

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTES_PER_DAY = 24 * 60;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/;

export function isWeekday(value: number): value is Weekday {
  return (WEEKDAYS as readonly number[]).includes(value);
}

export function isExceptionKind(value: string): value is ExceptionKind {
  return (EXCEPTION_KINDS as readonly string[]).includes(value);
}

function minutesOf(time: string): number | null {
  const match = TIME.exec(time);
  return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
}

type CheckedRule = { index: number; rule: AvailabilityRule; from: number; to: number };

function checkRule(
  index: number,
  { weekday, start, end }: { weekday: number; start: string; end: string },
): CheckedRule | RuleIssue {
  if (!isWeekday(weekday)) {
    return { index, reason: "invalid_weekday" };
  }
  const from = minutesOf(start);
  const to = end === END_OF_DAY ? MINUTES_PER_DAY : minutesOf(end);
  if (from === null || to === null) {
    return { index, reason: "invalid_time" };
  }
  if (from >= to) {
    return { index, reason: "invalid_order" };
  }
  if (to - from < MIN_RULE_MINUTES) {
    return { index, reason: "too_short" };
  }
  return { index, rule: { weekday, start, end }, from, to };
}

/**
 * The full weekly list. More than 50 → "too_many". Otherwise one issue per faulty rule by ascending index; overlaps
 * (same weekday, `[start, end)` intersecting) are only looked for between otherwise valid rules, and flag both rules.
 * Success: sorted by weekday then start.
 */
export function parseAvailabilityRules(
  rules: readonly { weekday: number; start: string; end: string }[],
): Result<AvailabilityRule[], "too_many" | RuleIssue[]> {
  if (rules.length > MAX_AVAILABILITY_RULES) {
    return err("too_many");
  }
  const issues = new Map<number, RuleIssueReason>();
  const valid: CheckedRule[] = [];
  rules.forEach((rule, index) => {
    const checked = checkRule(index, rule);
    if ("reason" in checked) {
      issues.set(index, checked.reason);
    } else {
      valid.push(checked);
    }
  });
  for (const [position, a] of valid.entries()) {
    for (const b of valid.slice(position + 1)) {
      if (a.rule.weekday === b.rule.weekday && a.from < b.to && b.from < a.to) {
        issues.set(a.index, "overlap");
        issues.set(b.index, "overlap");
      }
    }
  }
  if (issues.size > 0) {
    return err(
      [...issues.entries()].sort(([a], [b]) => a - b).map(([index, reason]) => ({ index, reason })),
    );
  }
  return ok(
    valid.sort((a, b) => a.rule.weekday - b.rule.weekday || a.from - b.from).map(({ rule }) => rule),
  );
}

/** `datetime-local` value "YYYY-MM-DDTHH:MM" (real calendar date) read in `zone`, as PostgreSQL `at time zone`. */
function localToInstant(value: string, zone: TimeZone): Temporal.Instant | null {
  const match = LOCAL_DATE_TIME.exec(value);
  if (match === null || minutesOf(match[4] ?? "") === null) {
    return null;
  }
  let date: Temporal.PlainDate;
  try {
    date = Temporal.PlainDate.from(
      { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) },
      { overflow: "reject" },
    );
  } catch {
    return null;
  }
  return wallClockToInstant(date, match[4] ?? "", zone);
}

function toIsoString(instant: Temporal.Instant): string {
  return new Date(instant.epochMilliseconds).toISOString();
}

/**
 * Absence or one-off opening typed in the profile's `timeZone` (nonexistent and ambiguous local times read as
 * PostgreSQL, see `wallClockToInstant`). First error in `ExceptionError` order; an ongoing exception is accepted.
 */
export function parseAvailabilityException(
  input: { kind: string; start: string; end: string },
  timeZone: TimeZone,
  now: Date,
): Result<NewExceptionRange, ExceptionError> {
  if (!isExceptionKind(input.kind)) {
    return err("invalid_kind");
  }
  const start = localToInstant(input.start, timeZone);
  if (start === null) {
    return err("invalid_start");
  }
  const end = localToInstant(input.end, timeZone);
  if (end === null) {
    return err("invalid_end");
  }
  if (Temporal.Instant.compare(end, start) <= 0) {
    return err("invalid_range");
  }
  if (end.epochMilliseconds <= now.getTime()) {
    return err("already_ended");
  }
  return ok({ kind: input.kind, startsAt: toIsoString(start), endsAt: toIsoString(end) });
}
