import { z } from "zod";

import { isWeekday, type AvailabilityRule } from "@/domain/booking/availability";
import { parseInstant } from "@/domain/booking/booking";
import { isLocationKind } from "@/domain/booking/event-type";
import type { PublicBookingPage, PublicBookingReader, PublicBusyRanges, PublicEventType } from "@/domain/booking/ports";
import { timeRange, type TimeRange } from "@/domain/booking/time-range";
import { END_OF_DAY, parseTimeZone } from "@/domain/booking/time-zone";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

/** SQL `time` as jsonb text; only whole minutes are valid rules. */
const SQL_TIME = /^([01]\d|2[0-3]):[0-5]\d:00$/;
const SQL_END_OF_DAY = "24:00:00";

const pageSchema = z.object({
  time_zone: z.string(),
  event_types: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      duration_min: z.int(),
      buffer_min: z.int(),
      min_notice_min: z.int(),
      location_kind: z.string(),
      position: z.int(),
      location_text: z.string().nullish(),
    }),
  ),
  rules: z.array(z.object({ weekday: z.int(), start_time: z.string(), end_time: z.string() })),
});

const rangesSchema = z.array(z.object({ start: z.string(), end: z.string() }));
const busySchema = z.object({ busy: rangesSchema, extra: rangesSchema });

type PageJson = z.infer<typeof pageSchema>;

function ruleTime(text: string, isEnd: boolean): string | null {
  if (isEnd && text === SQL_END_OF_DAY) {
    return END_OF_DAY;
  }
  return SQL_TIME.test(text) ? text.slice(0, 5) : null;
}

function toRule({ weekday, start_time, end_time }: PageJson["rules"][number]): AvailabilityRule | null {
  const start = ruleTime(start_time, false);
  const end = ruleTime(end_time, true);
  return isWeekday(weekday) && start !== null && end !== null ? { weekday, start, end } : null;
}

/** The address is public for in_person only: a visio link is never shown (0036, point 14). */
function toEventType(row: PageJson["event_types"][number]): PublicEventType | null {
  if (!isLocationKind(row.location_kind)) {
    return null;
  }
  return {
    id: row.id,
    title: row.title,
    durationMin: row.duration_min,
    bufferMin: row.buffer_min,
    minNoticeMin: row.min_notice_min,
    locationKind: row.location_kind,
    locationText: row.location_kind === "in_person" ? (row.location_text ?? null) : null,
    position: row.position,
  };
}

function toPage(data: unknown): PublicBookingPage | null {
  const parsed = pageSchema.safeParse(data);
  if (!parsed.success) {
    return null;
  }
  const timeZone = parseTimeZone(parsed.data.time_zone);
  const eventTypes = parsed.data.event_types.map(toEventType);
  const rules = parsed.data.rules.map(toRule);
  if (timeZone === null || eventTypes.includes(null) || rules.includes(null)) {
    return null;
  }
  return {
    timeZone,
    eventTypes: eventTypes.filter((type) => type !== null),
    rules: rules.filter((rule) => rule !== null),
  };
}

function toRanges(rows: z.infer<typeof rangesSchema>): TimeRange[] | null {
  const ranges: TimeRange[] = [];
  for (const row of rows) {
    const start = parseInstant(row.start);
    const end = parseInstant(row.end);
    const range = start === null || end === null ? null : timeRange(start, end);
    if (range === null) {
      return null;
    }
    ranges.push(range);
  }
  return ranges;
}

function toBusyRanges(data: unknown): PublicBusyRanges | null {
  const parsed = busySchema.safeParse(data);
  if (!parsed.success) {
    return null;
  }
  const busy = toRanges(parsed.data.busy);
  const extra = toRanges(parsed.data.extra);
  return busy === null || extra === null ? null : { busy, extra };
}

/**
 * `carnet.get_public_booking_page` / `get_public_busy_ranges` (security definer, published profiles only) through
 * the cookie-less anonymous client. Any unexpected shape is `unexpected`, logged by code, never by value.
 */
export function makeSupabasePublicBookingReader(client: CarnetClient): PublicBookingReader {
  return {
    async page(slug) {
      const { data, error } = await client.rpc("get_public_booking_page", { p_slug: slug });
      if (error !== null) {
        logInfrastructureError("get_public_booking_page", error.code);
        return err("unexpected");
      }
      if (data === null) {
        return ok(null);
      }
      const page = toPage(data);
      if (page === null) {
        logInfrastructureError("get_public_booking_page", "malformed_page");
        return err("unexpected");
      }
      return ok(page);
    },
    async busyRanges(slug, range) {
      const { data, error } = await client.rpc("get_public_busy_ranges", {
        p_slug: slug,
        p_from: range.start.toString(),
        p_to: range.end.toString(),
      });
      if (error !== null) {
        logInfrastructureError("get_public_busy_ranges", error.code);
        return err("unexpected");
      }
      if (data === null) {
        return ok(null);
      }
      const ranges = toBusyRanges(data);
      if (ranges === null) {
        logInfrastructureError("get_public_busy_ranges", "malformed_ranges");
        return err("unexpected");
      }
      return ok(ranges);
    },
  };
}
