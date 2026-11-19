import { MAX_OCCUPIED_MINUTES, parseInstant, SLOT_READ_WINDOW_HOURS } from "@/domain/booking/booking";
import type { PublicBookingReader } from "@/domain/booking/ports";
import { BOOKING_HORIZON_HOURS, computeSlots, type Slot } from "@/domain/booking/slots";
import { SLUG_PATTERN } from "@/domain/profile/slug";
import type { Clock } from "@/domain/shared/ports/clock";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, ok, type Result } from "@/domain/shared/result";
import { enforceRateLimits } from "@/server/use-cases/shared/enforce-rate-limits";

export type ListPublicSlotsInput = {
  slug: string;
  eventTypeId: string;
  from: string;
  to: string;
  clientAddress: string;
};

export type ListPublicSlotsError = "not_found" | "invalid_range" | "rate_limited" | "too_many_slots" | "unexpected";

export type ListPublicSlots = (input: ListPublicSlotsInput) => Promise<Result<readonly Slot[], ListPublicSlotsError>>;

/** A browser's local midnight may precede now by up to a day. */
const EARLIEST_FROM_HOURS = 24;

function maxInstant(a: Temporal.Instant, b: Temporal.Instant): Temporal.Instant {
  return Temporal.Instant.compare(a, b) >= 0 ? a : b;
}

function minInstant(a: Temporal.Instant, b: Temporal.Instant): Temporal.Instant {
  return Temporal.Instant.compare(a, b) <= 0 ? a : b;
}

/**
 * One local week [from, to) of a type's slots (`to − from` ≤ SLOT_READ_WINDOW_HOURS; the id is validated by the
 * action), display-side mirror of `book_slot` (the authority). Rate limit `booking-slots` on the address before any
 * read; occupations read from max(from, now) to the horizon-capped end of
 * the week plus MAX_OCCUPIED_MINUTES, so that a slot whose buffer reaches past the week is not offered then refused.
 */
export function makeListPublicSlots(deps: {
  rateLimiter: RateLimiter;
  pages: PublicBookingReader;
  clock: Clock;
}): ListPublicSlots {
  return async ({ slug, eventTypeId, from, to, clientAddress }) => {
    if (!SLUG_PATTERN.test(slug)) {
      return err("not_found");
    }
    const now = Temporal.Instant.fromEpochMilliseconds(deps.clock.now().getTime());
    const horizon = now.add({ hours: BOOKING_HORIZON_HOURS });
    const start = parseInstant(from);
    if (
      start === null ||
      Temporal.Instant.compare(start, now.subtract({ hours: EARLIEST_FROM_HOURS })) < 0 ||
      Temporal.Instant.compare(start, horizon) > 0
    ) {
      return err("invalid_range");
    }
    const end = parseInstant(to);
    if (
      end === null ||
      Temporal.Instant.compare(end, start) <= 0 ||
      Temporal.Instant.compare(end, start.add({ hours: SLOT_READ_WINDOW_HOURS })) > 0
    ) {
      return err("invalid_range");
    }
    const limited = await enforceRateLimits(deps.rateLimiter, [{ scope: "booking-slots", subject: clientAddress }]);
    if (!limited.ok) {
      return err(limited.error);
    }
    const page = await deps.pages.page(slug);
    if (!page.ok) {
      return err("unexpected");
    }
    const eventType = page.value?.eventTypes.find((type) => type.id === eventTypeId);
    if (page.value === null || eventType === undefined) {
      return err("not_found");
    }
    const occupations = await deps.pages.busyRanges(slug, {
      start: maxInstant(start, now),
      end: minInstant(end, horizon).add({ minutes: MAX_OCCUPIED_MINUTES }),
    });
    if (!occupations.ok) {
      return err("unexpected");
    }
    if (occupations.value === null) {
      return err("not_found");
    }
    const slots = computeSlots({
      timeZone: page.value.timeZone,
      eventType,
      rules: page.value.rules,
      extra: occupations.value.extra,
      busy: occupations.value.busy,
      now,
      range: { start, end },
    });
    return slots.ok ? ok(slots.value) : err(slots.error);
  };
}
