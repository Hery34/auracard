/**
 * Contract frozen by test-engineer (0039, decision 2, point 8; notes reported from 0037 and from the 0037/0038 audit:
 * one local week per request, occupations up to `to + 720 min`, rules "HH:MM", rate limit on the read, too_many_slots
 * handled).
 * Only the ports are fakes (rate limiter, public reader, clock); computeSlots (domain) is the real one.
 *
 * // src/domain/booking/ports.ts
 * export type PublicEventType = { id: string; title: string; durationMin: number; bufferMin: number;
 *   minNoticeMin: number; locationKind: LocationKind; locationText: string | null; position: number };
 * export type PublicBookingPage = { timeZone: TimeZone; eventTypes: PublicEventType[]; rules: AvailabilityRule[] };
 * export type PublicBusyRanges = { busy: TimeRange[]; extra: TimeRange[] };
 * // carnet.get_public_booking_page / get_public_busy_ranges (0036), anonymous client, never service_role.
 * export interface PublicBookingReader {
 *   page(slug: string): Promise<Result<PublicBookingPage | null, "unexpected">>;   // null: unknown or unpublished
 *   busyRanges(slug: string, range: TimeRange): Promise<Result<PublicBusyRanges | null, "unexpected">>;
 * }
 *
 * // src/domain/shared/rate-limits.ts: "booking-slots" = { limit: 60, windowSeconds: 3600 } (address).
 *
 * // src/server/booking/use-cases/list-public-slots.ts
 * // Point 8: `to` is the browser's local midnight a week after `from` (167, 168 or 169 h); eventTypeId is already
 * // validated by the action (uuid, lower case): the use case depends on no Zod schema of the action layer.
 * export type ListPublicSlotsInput = { slug: string; eventTypeId: string; from: string; to: string; clientAddress: string };
 * export type ListPublicSlotsError = "not_found" | "invalid_range" | "rate_limited" | "too_many_slots" | "unexpected";
 * export type ListPublicSlots = (input: ListPublicSlotsInput) => Promise<Result<readonly Slot[], ListPublicSlotsError>>;
 * export function makeListPublicSlots(deps: { rateLimiter: RateLimiter; pages: PublicBookingReader; clock: Clock }): ListPublicSlots;
 * //   1. no port called: slug not SLUG_PATTERN → not_found; `from` not an instant with offset (≤ 64 characters),
 * //      before now − 24 h, or after now + 1440 h → invalid_range; `to` not an instant with offset, not after
 * //      `from`, or more than SLOT_READ_WINDOW_HOURS (169) after it → invalid_range;
 * //   2. rateLimiter "booking-slots" on clientAddress → rate_limited | unexpected (nothing read);
 * //   3. pages.page(slug): null, or eventTypeId not among its active types → not_found;
 * //   4. displayed range [from, to) (one local week, as sent);
 * //      pages.busyRanges(slug, { start: max(from, now), end: min(to, now + 1440 h) + MAX_OCCUPIED_MINUTES }) —
 * //      always inside the window of get_public_busy_ranges ([now − 1 day, now + 1440 h + 1 day], ≤ 62 days);
 * //      null → not_found;
 * //   5. computeSlots({ timeZone, eventType (duration, buffer, notice of the type), rules, extra, busy, now, range })
 * //      → ok(slots) | err("too_many_slots").
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { computeSlots } from "@/domain/booking/slots";
import type { TimeRange } from "@/domain/booking/time-range";
import { err } from "@/domain/shared/result";
import { makeListPublicSlots, type ListPublicSlotsInput } from "@/server/booking/use-cases/list-public-slots";

import {
  aPublicBookingPage,
  aPublicEventType,
  BOOKING_NOW,
  BOOKING_SLUG,
  BOOKING_VISITOR_ADDRESS,
  PUBLIC_EVENT_TYPE_IDS,
  rangeText,
  UNKNOWN_EVENT_TYPE_ID,
} from "../../../../tests/builders/booking";
import { bookingBusy, instant, range, starts } from "../../../../tests/builders/booking-slots";
import { makeCallLog } from "../../../../tests/builders/call-log";
import {
  fakePublicBookingReader,
  type FakePublicBookingReaderOptions,
} from "../../../../tests/builders/fake-public-booking-reader";
import { fakeRateLimiter, type FakeRateLimiterOptions } from "../../../../tests/builders/fake-rate-limiter";
import { fixedClock } from "../../../../tests/builders/stats";

/** Tuesday 2 March 2027 00:00 in Paris (CET): the day after BOOKING_NOW, a local midnight sent by the browser. */
const FROM = "2027-03-01T23:00:00Z";
/** FROM + 168 h. */
const TO = "2027-03-08T23:00:00Z";
/** BOOKING_NOW + 1440 h. */
const HORIZON = "2027-04-30T12:00:00Z";

type HarnessOptions = {
  limiter?: Omit<FakeRateLimiterOptions, "log">;
  pages?: Omit<FakePublicBookingReaderOptions, "log">;
};

function harness(options: HarnessOptions = {}) {
  const log = makeCallLog();
  const listPublicSlots = makeListPublicSlots({
    rateLimiter: fakeRateLimiter({ log, ...options.limiter }),
    pages: fakePublicBookingReader({ log, ...options.pages }),
    clock: fixedClock(BOOKING_NOW),
  });
  return { log, listPublicSlots };
}

function input(overrides: Partial<ListPublicSlotsInput> = {}): ListPublicSlotsInput {
  return { slug: BOOKING_SLUG, eventTypeId: PUBLIC_EVENT_TYPE_IDS.video, from: FROM, to: TO, clientAddress: BOOKING_VISITOR_ADDRESS, ...overrides };
}

function busyRequests(log: ReturnType<typeof makeCallLog>): { slug: string; range: [string, string] }[] {
  return log
    .inputsOf("pages", "busyRanges")
    .map((call) => call as { slug: string; range: TimeRange })
    .map(({ slug, range: requested }) => ({ slug, range: rangeText(requested) }));
}

const SLOTS_CONSUMPTION = { scope: "booking-slots", subject: BOOKING_VISITOR_ADDRESS, limit: 60, windowSeconds: 3600 };

describe("listPublicSlots", () => {
  it("decision 2: the slots of one week, computed by computeSlots on the type, rules and occupations read", async () => {
    const occupations = { busy: [bookingBusy("2027-03-03T08:00:00Z", 30, 0)], extra: [range("2027-03-06T09:00:00Z", "2027-03-06T10:00:00Z")] };
    const { listPublicSlots } = harness({ pages: { busyRanges: occupations } });

    const result = await listPublicSlots(input());

    const page = aPublicBookingPage();
    const expected = computeSlots({
      timeZone: page.timeZone,
      eventType: { durationMin: 30, bufferMin: 0, minNoticeMin: 120 },
      rules: page.rules,
      extra: occupations.extra,
      busy: occupations.busy,
      now: instant(BOOKING_NOW),
      range: range(FROM, TO),
    });
    expect(expected.ok).toBe(true);
    expect(result.ok).toBe(true);
    const offered = result.ok ? starts(result.value) : [];
    expect(offered).toStrictEqual(expected.ok ? starts(expected.value) : null);
    expect(offered[0]).toBe("2027-03-02T08:00:00Z");
    expect(offered).not.toContain("2027-03-03T08:00:00Z");
    expect(offered).toContain("2027-03-06T09:00:00Z");
    expect(offered.every((start) => start >= FROM && start < TO)).toBe(true);
  });

  it("the type's duration, buffer and notice are used (in-person visit: 60 min, buffer 15, 24 h notice)", async () => {
    const { listPublicSlots } = harness({ pages: { busyRanges: { busy: [bookingBusy("2027-03-03T10:00:00Z", 60, 15)], extra: [] } } });

    const result = await listPublicSlots(input({ eventTypeId: PUBLIC_EVENT_TYPE_IDS.inPerson }));

    const offered = result.ok ? starts(result.value) : [];
    expect(offered).not.toContain("2027-03-02T08:00:00Z");
    expect(offered).toContain("2027-03-02T13:00:00Z");
    expect(offered).not.toContain("2027-03-03T09:00:00Z");
    expect(result.ok ? result.value.every((slot) => slot.end.since(slot.start).total("minutes") === 60) : false).toBe(true);
  });

  describe("note reported from 0037: occupations read up to to + 720 min, inside the public window", () => {
    it("a week after now → busyRanges(slug, [from, to + 720 min))", async () => {
      const { log, listPublicSlots } = harness();

      await listPublicSlots(input());

      expect(busyRequests(log)).toStrictEqual([{ slug: BOOKING_SLUG, range: [FROM, "2027-03-09T11:00:00Z"] }]);
    });

    it("a week starting before now (browser's local midnight) → read from now, never in the past", async () => {
      const { log, listPublicSlots } = harness();
      const from = "2027-03-01T00:00:00Z";

      await listPublicSlots(input({ from, to: "2027-03-08T00:00:00Z" }));

      expect(busyRequests(log)).toStrictEqual([{ slug: BOOKING_SLUG, range: [BOOKING_NOW, "2027-03-08T12:00:00Z"] }]);
    });

    it("a week crossing the 60-day horizon → read ends at horizon + 720 min (get_public_busy_ranges accepts it)", async () => {
      const { log, listPublicSlots } = harness();
      const from = "2027-04-28T22:00:00Z";

      const result = await listPublicSlots(input({ from, to: "2027-05-05T22:00:00Z" }));

      expect(result.ok).toBe(true);
      const [request] = busyRequests(log);
      const [start = "", end = ""] = request?.range ?? [];
      expect(start).toBe(from);
      expect(Temporal.Instant.compare(instant(end), instant(HORIZON).add({ minutes: 720 }))).toBeGreaterThanOrEqual(0);
      expect(Temporal.Instant.compare(instant(end), instant(BOOKING_NOW).add({ hours: 1440 + 24 }))).toBeLessThanOrEqual(0);
      expect(instant(end).since(instant(start)).total("hours")).toBeLessThanOrEqual(62 * 24);
    });

    it("an occupation starting after `to` but within its buffer removes the last slot of the range", async () => {
      const page = aPublicBookingPage({
        eventTypes: [aPublicEventType({ durationMin: 60, bufferMin: 240, minNoticeMin: 0 })],
        rules: [{ weekday: 1, start: "20:00", end: "24:00" }],
      });
      const occupations = { busy: [bookingBusy("2027-03-09T01:00:00Z", 30, 0)], extra: [] };
      const { listPublicSlots } = harness({ pages: { page, busyRanges: occupations } });

      const result = await listPublicSlots(input());

      // Monday 20:00–24:00 in Paris = 19:00Z–23:00Z; 21:00Z and 22:00Z would end their buffer after 01:00Z.
      expect(result.ok ? starts(result.value) : []).toStrictEqual(["2027-03-08T19:00:00Z", "2027-03-08T20:00:00Z"]);
    });
  });

  describe("step 1 — validation, no port called", () => {
    it("a malformed slug → not_found", async () => {
      const { log, listPublicSlots } = harness();

      expect(await listPublicSlots(input({ slug: "../admin" }))).toStrictEqual(err("not_found"));
      expect(log.sequence()).toStrictEqual([]);
    });

    it("point 8 (layers): the event type id is validated by the action — no Zod schema of the action layer here", () => {
      const source = readFileSync(new URL("./list-public-slots.ts", import.meta.url), "utf8");

      expect(source).not.toContain("@/server/booking/action-schemas");
      expect(source).not.toMatch(/from "zod"/);
    });

    it("point 8 (layers): an id absent from the page is not_found once the page is read (no second validation)", async () => {
      const { log, listPublicSlots } = harness();

      expect(await listPublicSlots(input({ eventTypeId: "video" }))).toStrictEqual(err("not_found"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "pages.page"]);
    });

    it.each([
      ["not a date", "lundi"],
      ["a local date-time without offset", "2027-03-02T00:00"],
      ["more than 24 h before now", "2027-02-28T11:59:00Z"],
      ["after the 60-day horizon", "2027-04-30T12:01:00Z"],
      ["huge", "9".repeat(10_000)],
    ])("from %s → invalid_range", async (_label, from) => {
      const { log, listPublicSlots } = harness();

      expect(await listPublicSlots(input({ from }))).toStrictEqual(err("invalid_range"));
      expect(log.sequence()).toStrictEqual([]);
    });

    it("bounds accepted: exactly now − 24 h and exactly now + 1440 h", async () => {
      const { listPublicSlots } = harness();

      expect((await listPublicSlots(input({ from: "2027-02-28T12:00:00Z", to: "2027-03-07T12:00:00Z" }))).ok).toBe(true);
      expect((await listPublicSlots(input({ from: HORIZON, to: "2027-05-07T12:00:00Z" }))).ok).toBe(true);
    });

    it.each([
      ["not a date", "lundi"],
      ["a local date-time without offset", "2027-03-08T00:00"],
      ["equal to from", FROM],
      ["before from", "2027-03-01T22:00:00Z"],
      ["more than 169 h after from (169 h 01)", "2027-03-09T00:01:00Z"],
      ["huge", "9".repeat(10_000)],
    ])("point 8: to %s → invalid_range", async (_label, to) => {
      const { log, listPublicSlots } = harness();

      expect(await listPublicSlots(input({ to }))).toStrictEqual(err("invalid_range"));
      expect(log.sequence()).toStrictEqual([]);
    });

    it("point 8: to = from + 169 h exactly (SLOT_READ_WINDOW_HOURS) is accepted", async () => {
      const { listPublicSlots } = harness();

      expect((await listPublicSlots(input({ to: "2027-03-09T00:00:00Z" }))).ok).toBe(true);
    });
  });

  describe("step 2 — limit booking-slots:<address> 60/h (audit 0037/0038: cost of the computation)", () => {
    it("consumed once per read, before any read", async () => {
      const { log, listPublicSlots } = harness();

      await listPublicSlots(input());

      expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "pages.page", "pages.busyRanges"]);
      expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([SLOTS_CONSUMPTION]);
    });

    it("exhausted → rate_limited, nothing read", async () => {
      const { log, listPublicSlots } = harness({ limiter: { deny: ["booking-slots"] } });

      expect(await listPublicSlots(input())).toStrictEqual(err("rate_limited"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume"]);
    });

    it("failing limiter → unexpected, nothing read", async () => {
      const { log, listPublicSlots } = harness({ limiter: { failing: true } });

      expect(await listPublicSlots(input())).toStrictEqual(err("unexpected"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume"]);
    });
  });

  describe("steps 3 and 4 — profile and type", () => {
    it("criterion 3: unpublished or unknown profile → not_found, occupations not read", async () => {
      const { log, listPublicSlots } = harness({ pages: { published: [] } });

      expect(await listPublicSlots(input())).toStrictEqual(err("not_found"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "pages.page"]);
    });

    it("criterion 3: type absent from the page (inactive, deleted, another profile's) → not_found", async () => {
      const { log, listPublicSlots } = harness();

      expect(await listPublicSlots(input({ eventTypeId: UNKNOWN_EVENT_TYPE_ID }))).toStrictEqual(err("not_found"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "pages.page"]);
    });

    it("profile unpublished between the two reads → not_found", async () => {
      const { listPublicSlots } = harness({ pages: { unpublishedBeforeBusyRanges: true } });

      expect(await listPublicSlots(input())).toStrictEqual(err("not_found"));
    });

    it.each([
      ["page", { failingPage: true }],
      ["occupations", { failingBusyRanges: true }],
    ])("failing read (%s) → unexpected", async (_label, pages) => {
      expect(await harness({ pages }).listPublicSlots(input())).toStrictEqual(err("unexpected"));
    });
  });

  it("audit 0037: too_many_slots is handled — an error, never a truncated list nor an exception", async () => {
    const page = aPublicBookingPage({ eventTypes: [aPublicEventType({ durationMin: 5, minNoticeMin: 0 })] });
    const extra = Array.from({ length: 11 }, (_, index) => {
      const start = instant(FROM).add({ seconds: 20 * index });
      return { start, end: start.add({ hours: 168 }) };
    });
    const { listPublicSlots } = harness({ pages: { page, busyRanges: { busy: [], extra } } });

    expect(await listPublicSlots(input())).toStrictEqual(err("too_many_slots"));
  });

  it("criterion 4 (DST): a week across the spring change in Paris keeps real-time steps from each rule start", async () => {
    const page = aPublicBookingPage({ rules: [{ weekday: 7, start: "01:00", end: "04:00" }] });
    const listAtMarch22 = makeListPublicSlots({
      rateLimiter: fakeRateLimiter(),
      pages: fakePublicBookingReader({ page }),
      clock: fixedClock("2027-03-22T12:00:00Z"),
    });

    // Local week Tuesday 23 March 00:00 CET → Tuesday 30 March 00:00 CEST: 167 h.
    const result = await listAtMarch22(input({ eventTypeId: PUBLIC_EVENT_TYPE_IDS.video, from: "2027-03-22T23:00:00Z", to: "2027-03-29T22:00:00Z" }));

    expect(result.ok ? starts(result.value) : []).toStrictEqual([
      "2027-03-28T00:00:00Z",
      "2027-03-28T00:30:00Z",
      "2027-03-28T01:00:00Z",
      "2027-03-28T01:30:00Z",
    ]);
  });

  it("criterion 4 (DST), point 8: the local week of Sunday 31 October 2027 in Paris lasts 169 h, its last hour is offered", async () => {
    const page = aPublicBookingPage({ rules: [{ weekday: 6, start: "23:00", end: "24:00" }] });
    const log = makeCallLog();
    const listAtOctober30 = makeListPublicSlots({
      rateLimiter: fakeRateLimiter({ log }),
      pages: fakePublicBookingReader({ log, page }),
      clock: fixedClock("2027-10-30T12:00:00Z"),
    });

    // Sunday 31 October 00:00 CEST → Sunday 7 November 00:00 CET; Saturday 6 November 23:00–24:00 CET = 22:00Z–23:00Z.
    const result = await listAtOctober30(input({ from: "2027-10-30T22:00:00Z", to: "2027-11-06T23:00:00Z" }));

    expect(result.ok ? starts(result.value) : []).toStrictEqual(["2027-11-06T22:00:00Z", "2027-11-06T22:30:00Z"]);
    expect(busyRequests(log)).toStrictEqual([{ slug: BOOKING_SLUG, range: ["2027-10-30T22:00:00Z", "2027-11-07T11:00:00Z"] }]);
  });

  it("a read writes nothing and gives the same slots twice", async () => {
    const { listPublicSlots } = harness();

    const first = await listPublicSlots(input());
    const second = await listPublicSlots(input());

    expect(first.ok && second.ok ? starts(first.value) : null).toStrictEqual(second.ok ? starts(second.value) : undefined);
  });
});
