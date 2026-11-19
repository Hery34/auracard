/**
 * Contract frozen by test-engineer (0030, decision 8 amended by Hery on 18/11/2026).
 *
 * // src/server/repositories/supabase-daily-aggregate-reader.ts
 * export function makeSupabaseDailyAggregateReader(server: CarnetClient): DailyAggregateReader;
 * // listOwn(profileId, range): one call, rpc("get_own_daily_aggregates", { p_profile_id: profileId, p_from: range.from,
 * // p_to: range.to }). Each element must have day "YYYY-MM-DD" and an integer value; otherwise, like a PostgREST error
 * // or a non-array payload, logInfrastructureError("get_own_daily_aggregates", …) and err("unexpected").
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSupabaseDailyAggregateReader } from "@/server/repositories/supabase-daily-aggregate-reader";

import { fakeSupabaseAdmin } from "../../../tests/builders/fake-supabase-admin";
import { aDailyAggregate, aDailyAggregateRow, DELETED_LINK_ID, STATS_TODAY } from "../../../tests/builders/stats";

const PROFILE_ID = "00000000-0000-4000-8000-000000003010";
const RANGE = { from: "2026-11-12", to: STATS_TODAY };

afterEach(() => {
  vi.restoreAllMocks();
});

function silenceErrors() {
  return vi.spyOn(console, "error").mockImplementation(() => undefined);
}

describe("makeSupabaseDailyAggregateReader", () => {
  it("decision 8: one call, rpc('get_own_daily_aggregates', { p_profile_id, p_from, p_to }) with the given profile id", async () => {
    const server = fakeSupabaseAdmin({ data: [], error: null });

    expect(await makeSupabaseDailyAggregateReader(server.client).listOwn(PROFILE_ID, RANGE)).toStrictEqual(ok([]));

    expect(server.calls).toStrictEqual([
      { fn: "get_own_daily_aggregates", args: { p_profile_id: PROFILE_ID, p_from: RANGE.from, p_to: RANGE.to } },
    ]);
  });

  it("maps every row to a DailyAggregate", async () => {
    const server = fakeSupabaseAdmin({
      data: [
        aDailyAggregateRow(),
        aDailyAggregateRow({ day: "2026-11-13", metric: "link_click", link_id: DELETED_LINK_ID, source: "nfc", value: 2 }),
        aDailyAggregateRow({ metric: "lead_submitted", source: null, value: 5 }),
      ],
      error: null,
    });

    expect(await makeSupabaseDailyAggregateReader(server.client).listOwn(PROFILE_ID, RANGE)).toStrictEqual(
      ok([
        aDailyAggregate(),
        aDailyAggregate({ day: "2026-11-13", metric: "link_click", linkId: DELETED_LINK_ID, source: "nfc", value: 2 }),
        aDailyAggregate({ metric: "lead_submitted", source: null, value: 5 }),
      ]),
    );
  });

  it("0039 (regression): booking_viewed, booking_started and booking_confirmed aggregates are read, the stats page keeps working", async () => {
    const server = fakeSupabaseAdmin({
      data: [
        aDailyAggregateRow({ metric: "booking_viewed", value: 4 }),
        aDailyAggregateRow({ metric: "booking_started", value: 2 }),
        aDailyAggregateRow({ metric: "booking_confirmed", value: 1 }),
      ],
      error: null,
    });

    expect(await makeSupabaseDailyAggregateReader(server.client).listOwn(PROFILE_ID, RANGE)).toStrictEqual(
      ok([
        aDailyAggregate({ metric: "booking_viewed", value: 4 }),
        aDailyAggregate({ metric: "booking_started", value: 2 }),
        aDailyAggregate({ metric: "booking_confirmed", value: 1 }),
      ]),
    );
  });

  it.each([
    ["2026-11-1"],
    ["18/11/2026"],
    ["2026-11-18T00:00:00Z"],
    [" 2026-11-18"],
    [""],
  ])("decision 8: day %j outside the YYYY-MM-DD format → err('unexpected')", async (day) => {
    const error = silenceErrors();
    const server = fakeSupabaseAdmin({ data: [aDailyAggregateRow(), aDailyAggregateRow({ day })], error: null });

    expect(await makeSupabaseDailyAggregateReader(server.client).listOwn(PROFILE_ID, RANGE)).toStrictEqual(err("unexpected"));
    expect(error).toHaveBeenCalledTimes(1);
  });

  it.each([[1.5], [Number.NaN], [Number.POSITIVE_INFINITY], ["3"]])(
    "decision 8: value %s not an integer → err('unexpected')",
    async (value) => {
      const error = silenceErrors();
      const server = fakeSupabaseAdmin({ data: [aDailyAggregateRow({ value })], error: null });

      expect(await makeSupabaseDailyAggregateReader(server.client).listOwn(PROFILE_ID, RANGE)).toStrictEqual(err("unexpected"));
      expect(error).toHaveBeenCalledTimes(1);
    },
  );

  it("a PostgREST error → err('unexpected'), the code logged under get_own_daily_aggregates", async () => {
    const error = silenceErrors();
    const server = fakeSupabaseAdmin({
      data: null,
      error: { code: "22023", message: "invalid date range", details: null, hint: null },
    });

    expect(await makeSupabaseDailyAggregateReader(server.client).listOwn(PROFILE_ID, RANGE)).toStrictEqual(err("unexpected"));
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({ source: "get_own_daily_aggregates", code: "22023" });
  });

  it("a payload that is not an array → err('unexpected')", async () => {
    silenceErrors();
    const server = fakeSupabaseAdmin({ data: null, error: null });

    expect(await makeSupabaseDailyAggregateReader(server.client).listOwn(PROFILE_ID, RANGE)).toStrictEqual(err("unexpected"));
  });
});
