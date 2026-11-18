/**
 * Contract frozen by test-engineer (0038 point 6, after review and audit) — boundary of the availability adapter.
 *
 * // src/domain/booking/ports.ts — AvailabilityRepository.getTimeZone parses the stored zone at the boundary:
 * //   getTimeZone(profileId: string): Promise<Result<TimeZone, "not_found" | "unexpected">>;
 * // src/server/booking/repositories/supabase-availability-repository.ts
 * //   getTimeZone: the stored `time_zone` is parsed by parseTimeZone (0037); a value it refuses (schema drift) →
 * //     err("unexpected"), logged by code only (logInfrastructureError, never the value).
 * //   Cap triggers (Hery, 18/11/2026, amends decision 17 of 0036): SQLSTATE CN004 « plafond atteint » →
 * //     limit_reached, translated by code and never by message; every other 23514 stays invalid_input, whatever its
 * //     message (the former "availability … limit reached" messages included).
 */
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { AvailabilityRepository } from "@/domain/booking/ports";
import type { TimeZone } from "@/domain/booking/time-zone";
import { err, ok, type Result } from "@/domain/shared/result";
import { makeSupabaseAvailabilityRepository } from "@/server/booking/repositories/supabase-availability-repository";

import { EXCEPTION_IDS, aWorkingWeek } from "../../../../tests/builders/booking-settings";
import { fakeCarnetQueryClient, type FakeQueryResponse } from "../../../../tests/builders/fake-carnet-query-client";
import { PROFILE_ID } from "../../../../tests/builders/fake-registrar";

function postgrestError(code: string, message: string): FakeQueryResponse {
  return { data: null, error: { code, message, details: null, hint: null } };
}

const EXCEPTION = {
  id: EXCEPTION_IDS[0],
  kind: "busy" as const,
  startsAt: "2026-12-24T13:00:00.000Z",
  endsAt: "2026-12-26T23:00:00.000Z",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getTimeZone — 0038 point 6: the stored zone is parsed at the boundary", () => {
  it("the port returns a TimeZone value object", () => {
    expectTypeOf<Awaited<ReturnType<AvailabilityRepository["getTimeZone"]>>>().toEqualTypeOf<
      Result<TimeZone, "not_found" | "unexpected">
    >();
  });

  it.each(["Europe/Paris", "America/New_York", "Asia/Calcutta"])("a stored %s → ok(that TimeZone)", async (zone) => {
    const { client } = fakeCarnetQueryClient({ tables: { profiles: { data: { time_zone: zone }, error: null } } });

    expect(await makeSupabaseAvailabilityRepository(client).getTimeZone(PROFILE_ID)).toStrictEqual(ok(zone));
  });

  it.each(["Mars/Olympus", "europe/paris", "+02:00", ""])(
    "a stored zone parseTimeZone refuses (%j) → unexpected, logged without the value",
    async (zone) => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { client } = fakeCarnetQueryClient({ tables: { profiles: { data: { time_zone: zone }, error: null } } });

      expect(await makeSupabaseAvailabilityRepository(client).getTimeZone(PROFILE_ID)).toStrictEqual(err("unexpected"));
      expect(logged).toHaveBeenCalledTimes(1);
      if (zone !== "") {
        expect(String(logged.mock.calls[0]?.[0])).not.toContain(zone);
      }
    },
  );

  it("no profile row → not_found (unchanged)", async () => {
    const { client } = fakeCarnetQueryClient({ tables: { profiles: { data: null, error: null } } });

    expect(await makeSupabaseAvailabilityRepository(client).getTimeZone(PROFILE_ID)).toStrictEqual(err("not_found"));
  });
});

describe("replaceRules — 0038 point 6: the cap is translated by code (CN004)", () => {
  it("CN004 → limit_reached, whatever the message", async () => {
    const { client } = fakeCarnetQueryClient({ rpc: { replace_availability_rules: postgrestError("CN004", "anything") } });

    expect(await makeSupabaseAvailabilityRepository(client).replaceRules(PROFILE_ID, aWorkingWeek())).toStrictEqual(
      err("limit_reached"),
    );
  });

  it("23514 carrying the former cap message → invalid_input (never translated by message)", async () => {
    const { client } = fakeCarnetQueryClient({
      rpc: { replace_availability_rules: postgrestError("23514", "availability rules limit reached") },
    });

    expect(await makeSupabaseAvailabilityRepository(client).replaceRules(PROFILE_ID, aWorkingWeek())).toStrictEqual(
      err("invalid_input"),
    );
  });

  it("any other 23514 → invalid_input (unchanged)", async () => {
    const { client } = fakeCarnetQueryClient({
      rpc: { replace_availability_rules: postgrestError("23514", 'violates check constraint "availability_rules_min_length_check"') },
    });

    expect(await makeSupabaseAvailabilityRepository(client).replaceRules(PROFILE_ID, aWorkingWeek())).toStrictEqual(
      err("invalid_input"),
    );
  });
});

describe("addException — 0038 point 6: the cap is translated by code (CN004)", () => {
  it("CN004 → limit_reached, whatever the message", async () => {
    const { client } = fakeCarnetQueryClient({ inserts: { availability_exceptions: postgrestError("CN004", "anything") } });

    expect(await makeSupabaseAvailabilityRepository(client).addException(PROFILE_ID, EXCEPTION)).toStrictEqual(
      err("limit_reached"),
    );
  });

  it("23514 carrying the former cap message → invalid_input (never translated by message)", async () => {
    const { client } = fakeCarnetQueryClient({
      inserts: { availability_exceptions: postgrestError("23514", "availability exceptions limit reached") },
    });

    expect(await makeSupabaseAvailabilityRepository(client).addException(PROFILE_ID, EXCEPTION)).toStrictEqual(
      err("invalid_input"),
    );
  });

  it("23514 of an ended exception (decision 4) → invalid_input (unchanged)", async () => {
    const { client } = fakeCarnetQueryClient({
      inserts: { availability_exceptions: postgrestError("23514", "availability exception already ended") },
    });

    expect(await makeSupabaseAvailabilityRepository(client).addException(PROFILE_ID, EXCEPTION)).toStrictEqual(
      err("invalid_input"),
    );
  });
});
