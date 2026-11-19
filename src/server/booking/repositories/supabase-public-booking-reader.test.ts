/**
 * Contract frozen by test-engineer (0039; notes reported from 0037: rules "HH:MM:SS" → "HH:MM"; 0036 point 14:
 * location_text public for in_person only).
 *
 * // src/server/booking/repositories/supabase-public-booking-reader.ts — anonymous client (createPublicSupabaseClient),
 * // never service_role: get_public_booking_page and get_public_busy_ranges are granted to anon (0036).
 * export function makeSupabasePublicBookingReader(client: CarnetClient): PublicBookingReader;
 * // page(slug): rpc("get_public_booking_page", { p_slug }) → SQL null → ok(null); otherwise
 * //   { timeZone: parseTimeZone(time_zone), eventTypes (order kept): { id, title, durationMin, bufferMin,
 * //   minNoticeMin, locationKind, locationText, position }, rules: { weekday, start, end } }.
 * //   locationText = location_text for in_person only (null when absent; ignored for phone and video even if sent).
 * //   Rules: "HH:MM:SS" → "HH:MM", "24:00:00" → END_OF_DAY ("24:00"); seconds other than ":00", an unknown
 * //   location kind, a zone parseTimeZone refuses, or any other shape → unexpected (logged by code, never the values).
 * // busyRanges(slug, range): rpc("get_public_busy_ranges", { p_slug, p_from, p_to }) with the instants of the range
 * //   as ISO 8601 text in UTC; SQL null → ok(null); { busy, extra } with timestamptz texts (any offset, fraction
 * //   allowed) → TimeRange[]; 22023 or any other error → unexpected (logged by code); malformed → unexpected.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { END_OF_DAY } from "@/domain/booking/time-zone";
import { err, ok } from "@/domain/shared/result";
import { makeSupabasePublicBookingReader } from "@/server/booking/repositories/supabase-public-booking-reader";

import { aPublicBookingPage, aPublicBookingPageJson, BOOKING_SLUG, postgrestError, PUBLIC_EVENT_TYPE_IDS, rangeText } from "../../../../tests/builders/booking";
import { instant, range } from "../../../../tests/builders/booking-slots";
import { fakeCarnetQueryClient, type FakeQueryResponse } from "../../../../tests/builders/fake-carnet-query-client";

function reader(rpc: Record<string, FakeQueryResponse>) {
  const fake = fakeCarnetQueryClient({ rpc });
  return { calls: fake.calls, pages: makeSupabasePublicBookingReader(fake.client) };
}

function pageReader(data: unknown) {
  return reader({ get_public_booking_page: { data, error: null } });
}

function silenceErrors() {
  return vi.spyOn(console, "error").mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("makeSupabasePublicBookingReader — page", () => {
  it("one rpc('get_public_booking_page', { p_slug }) → the page: camelCase, rules HH:MM, address for in_person only", async () => {
    const { calls, pages } = pageReader(aPublicBookingPageJson());

    expect(await pages.page(BOOKING_SLUG)).toStrictEqual(ok(aPublicBookingPage()));
    expect(calls).toStrictEqual([{ kind: "rpc", fn: "get_public_booking_page", args: { p_slug: BOOKING_SLUG } }]);
  });

  it("criterion 3: SQL null (unknown or unpublished slug) → ok(null)", async () => {
    expect(await pageReader(null).pages.page(BOOKING_SLUG)).toStrictEqual(ok(null));
  });

  it("a published profile without active type → an empty list of types (the use case answers not_found)", async () => {
    const result = await pageReader(aPublicBookingPageJson({ event_types: [] })).pages.page(BOOKING_SLUG);

    expect(result.ok ? result.value?.eventTypes : null).toStrictEqual([]);
  });

  it("note reported from 0037: '24:00:00' → END_OF_DAY, other times without their ':00' seconds", async () => {
    const result = await pageReader(
      aPublicBookingPageJson({ rules: [{ weekday: 7, start_time: "00:00:00", end_time: "24:00:00" }, { weekday: 1, start_time: "08:05:00", end_time: "12:55:00" }] }),
    ).pages.page(BOOKING_SLUG);

    expect(result.ok ? result.value?.rules : null).toStrictEqual([
      { weekday: 7, start: "00:00", end: END_OF_DAY },
      { weekday: 1, start: "08:05", end: "12:55" },
    ]);
  });

  it("0036 point 14: a location_text sent for a video or phone type is ignored (the visio link is never public)", async () => {
    const json = aPublicBookingPageJson();
    const types = (json.event_types as Record<string, unknown>[]).map((type) => ({ ...type, location_text: type.location_text ?? "javascript:alert(1)" }));

    const result = await pageReader({ ...json, event_types: types }).pages.page(BOOKING_SLUG);

    expect(result.ok ? result.value?.eventTypes.map((type) => [type.id, type.locationText]) : null).toStrictEqual([
      [PUBLIC_EVENT_TYPE_IDS.video, null],
      [PUBLIC_EVENT_TYPE_IDS.phone, null],
      [PUBLIC_EVENT_TYPE_IDS.inPerson, "12 rue des Lilas, 69003 Lyon"],
    ]);
  });

  it.each([
    ["seconds other than :00", { rules: [{ weekday: 1, start_time: "09:00:30", end_time: "12:00:00" }] }],
    ["a time without seconds nor zero padding", { rules: [{ weekday: 1, start_time: "9:00", end_time: "12:00:00" }] }],
    ["a weekday out of 1–7", { rules: [{ weekday: 8, start_time: "09:00:00", end_time: "12:00:00" }] }],
    ["an unknown time zone", { time_zone: "Mars/Olympus" }],
    ["an unknown location kind", { event_types: [{ ...(aPublicBookingPageJson().event_types as object[])[0], location_kind: "teams" }] }],
    ["a duration that is not an integer", { event_types: [{ ...(aPublicBookingPageJson().event_types as object[])[0], duration_min: "30" }] }],
    ["rules missing", { rules: undefined }],
  ])("malformed page (%s) → unexpected, logged by code only", async (_label, overrides) => {
    const error = silenceErrors();

    expect(await pageReader(aPublicBookingPageJson(overrides)).pages.page(BOOKING_SLUG)).toStrictEqual(err("unexpected"));
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).not.toContain("Appel découverte");
  });

  it("a PostgREST error → unexpected, logged by code", async () => {
    const error = silenceErrors();
    const { pages } = reader({ get_public_booking_page: { data: null, error: postgrestError("57014", "canceling statement") } });

    expect(await pages.page(BOOKING_SLUG)).toStrictEqual(err("unexpected"));
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({ level: "error", code: "57014" });
  });
});

describe("makeSupabasePublicBookingReader — busyRanges", () => {
  const REQUESTED = range("2027-03-01T23:00:00Z", "2027-03-09T11:00:00Z");

  function busyReader(response: FakeQueryResponse) {
    return reader({ get_public_busy_ranges: response });
  }

  it("one rpc('get_public_busy_ranges', { p_slug, p_from, p_to }) with the instants of the range", async () => {
    const { calls, pages } = busyReader({ data: { busy: [], extra: [] }, error: null });

    expect(await pages.busyRanges(BOOKING_SLUG, REQUESTED)).toStrictEqual(ok({ busy: [], extra: [] }));

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call).toMatchObject({ kind: "rpc", fn: "get_public_busy_ranges", args: { p_slug: BOOKING_SLUG } });
    const args = (call as { args: { p_from: string; p_to: string } }).args;
    expect(instant(args.p_from).equals(REQUESTED.start)).toBe(true);
    expect(instant(args.p_to).equals(REQUESTED.end)).toBe(true);
  });

  it("timestamptz texts (offset +00:00 or +01:00, fraction) → TimeRange, order kept", async () => {
    const { pages } = busyReader({
      data: {
        busy: [
          { start: "2027-03-03T08:00:00+00:00", end: "2027-03-03T08:30:00+00:00" },
          { start: "2027-03-05T09:15:00+01:00", end: "2027-03-05T09:45:00.5+01:00" },
        ],
        extra: [{ start: "2027-03-06T09:00:00+00:00", end: "2027-03-06T10:30:00+00:00" }],
      },
      error: null,
    });

    const result = await pages.busyRanges(BOOKING_SLUG, REQUESTED);

    expect(result.ok && result.value !== null ? result.value.busy.map(rangeText) : null).toStrictEqual([
      ["2027-03-03T08:00:00Z", "2027-03-03T08:30:00Z"],
      ["2027-03-05T08:15:00Z", "2027-03-05T08:45:00.5Z"],
    ]);
    expect(result.ok && result.value !== null ? result.value.extra.map(rangeText) : null).toStrictEqual([
      ["2027-03-06T09:00:00Z", "2027-03-06T10:30:00Z"],
    ]);
  });

  it("SQL null (unknown or unpublished slug) → ok(null)", async () => {
    expect(await busyReader({ data: null, error: null }).pages.busyRanges(BOOKING_SLUG, REQUESTED)).toStrictEqual(ok(null));
  });

  it("22023 (window refused by get_public_busy_ranges) → unexpected, logged by code", async () => {
    const error = silenceErrors();
    const { pages } = busyReader({ data: null, error: postgrestError("22023", "invalid range") });

    expect(await pages.busyRanges(BOOKING_SLUG, REQUESTED)).toStrictEqual(err("unexpected"));
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({ code: "22023" });
  });

  it.each([
    ["busy missing", { extra: [] }],
    ["a range without end", { busy: [{ start: "2027-03-03T08:00:00+00:00" }], extra: [] }],
    ["a local time without offset", { busy: [{ start: "2027-03-03T08:00:00", end: "2027-03-03T08:30:00" }], extra: [] }],
    ["an empty range", { busy: [{ start: "2027-03-03T08:00:00+00:00", end: "2027-03-03T08:00:00+00:00" }], extra: [] }],
  ])("malformed answer (%s) → unexpected", async (_label, data) => {
    silenceErrors();

    expect(await busyReader({ data, error: null }).pages.busyRanges(BOOKING_SLUG, REQUESTED)).toStrictEqual(err("unexpected"));
  });
});
