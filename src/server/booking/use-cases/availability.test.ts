/**
 * Contract frozen by test-engineer (0038, decision 1; notes of 0036; ADR 0016 §2).
 *
 * // src/domain/booking/ports.ts — under the session client (RLS), never service_role.
 * export type RulesWriteError = "not_found" | "overlap" | "limit_reached" | "invalid_input" | "unexpected";
 * export type ExceptionWriteError = "not_found" | "limit_reached" | "invalid_input" | "unexpected";
 * export interface AvailabilityRepository {
 *   // carnet.profiles.time_zone of the profile; not visible under the session → not_found. 0038 point 6: parsed at
 *   // the boundary (parseTimeZone), a stored value it refuses → unexpected (logged).
 *   getTimeZone(profileId: string): Promise<Result<TimeZone, "not_found" | "unexpected">>;
 *   // update profiles set time_zone (column grant of 0036); no row → not_found; 23514 → invalid_input.
 *   setTimeZone(profileId: string, timeZone: string): Promise<Result<void, "not_found" | "invalid_input" | "unexpected">>;
 *   // By weekday then start, "HH:MM" (an end of day reads "24:00"); at most 50 rows (direct read).
 *   listRules(profileId: string): Promise<Result<AvailabilityRule[], "unexpected">>;
 *   // carnet.replace_availability_rules(p_profile_id, p_rules) — the whole list in one transaction (a refusal keeps
 *   // the previous rules). 42501 → not_found; 23P01 → overlap; CN004 of the cap trigger (0038 point 6, by code, never
 *   // by message) → limit_reached; any 23514 or 22023 → invalid_input. Returns the stored rules, sorted.
 *   replaceRules(profileId: string, rules: readonly AvailabilityRule[]): Promise<Result<AvailabilityRule[], RulesWriteError>>;
 *   // Every exception whose end is after `now`, by startsAt then id, none missing beyond 100 (PostgREST max_rows:
 *   // pagination or a jsonb function).
 *   listUpcomingExceptions(profileId: string, now: Date): Promise<Result<AvailabilityException[], "unexpected">>;
 *   // Insert with the client-generated id (idempotency key): a replay of the caller's own id returns the stored row and
 *   // writes nothing; an id already used by another profile (23505 on the primary key) → invalid_input.
 *   // 42501 → not_found; CN004 of the cap trigger → limit_reached; any 23514 → invalid_input.
 *   addException(profileId: string, exception: AvailabilityException): Promise<Result<AvailabilityException, ExceptionWriteError>>;
 *   // Absent or someone else's: success, nothing done.
 *   removeException(profileId: string, id: string): Promise<Result<void, "unexpected">>;
 * }
 *
 * // src/server/booking/use-cases/save-time-zone.ts — parseSelectableTimeZone first (0038 point 6; nothing called when
 * // refused, the parsed TimeZone is the one written).
 * export type SaveTimeZoneError = "unauthenticated" | "not_found" | "rate_limited" | "invalid_input" | "unexpected";
 * export type SaveTimeZone = (timeZone: string) => Promise<Result<void, SaveTimeZoneError>>;
 * // replace-availability-rules.ts — rules already parsed by parseAvailabilityRules (action).
 * export type ReplaceAvailabilityRulesError = "unauthenticated" | "not_found" | "rate_limited" | RulesWriteError;
 * export type ReplaceAvailabilityRules = (rules: readonly AvailabilityRule[]) => Promise<Result<AvailabilityRule[], ReplaceAvailabilityRulesError>>;
 * // add-availability-exception.ts — deps add `clock: Clock`. authorize → getTimeZone → parseAvailabilityException(input,
 * // zone: TimeZone, clock.now()) → addException({ id, ...range }).
 * export type AddAvailabilityExceptionError = ExceptionError | "unauthenticated" | "not_found" | "rate_limited" | "limit_reached" | "invalid_input" | "unexpected";
 * export type AddAvailabilityException = (input: { id: string; kind: string; start: string; end: string }) => Promise<Result<AvailabilityException, AddAvailabilityExceptionError>>;
 * // remove-availability-exception.ts
 * export type RemoveAvailabilityExceptionError = "unauthenticated" | "not_found" | "rate_limited" | "unexpected";
 * export type RemoveAvailabilityException = (id: string) => Promise<Result<void, RemoveAvailabilityExceptionError>>;
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeAddAvailabilityException } from "@/server/booking/use-cases/add-availability-exception";
import { makeRemoveAvailabilityException } from "@/server/booking/use-cases/remove-availability-exception";
import { makeReplaceAvailabilityRules } from "@/server/booking/use-cases/replace-availability-rules";
import { makeSaveTimeZone } from "@/server/booking/use-cases/save-time-zone";

import {
  EXCEPTION_IDS,
  SETTINGS_NOW,
  aWorkingWeek,
  anException,
  anExceptionInput,
} from "../../../../tests/builders/booking-settings";
import { zone } from "../../../../tests/builders/booking-slots";
import { makeCallLog } from "../../../../tests/builders/call-log";
import {
  fakeAvailabilityRepository,
  type FakeAvailabilityRepositoryOptions,
} from "../../../../tests/builders/fake-availability-repository";
import {
  fakeAuthGateway,
  GATEWAY_USER_EMAIL,
  GATEWAY_USER_ID,
  type FakeAuthGatewayOptions,
} from "../../../../tests/builders/fake-auth-gateway";
import { fakeProfileReader, type FakeProfileReaderOptions } from "../../../../tests/builders/fake-profile-reader";
import { fakeRateLimiter, type FakeRateLimiterOptions } from "../../../../tests/builders/fake-rate-limiter";
import { PROFILE_ID } from "../../../../tests/builders/fake-registrar";
import { fixedClock } from "../../../../tests/builders/stats";

const AUTHENTICATED = ok({ userId: GATEWAY_USER_ID, email: GATEWAY_USER_EMAIL });
const PROFILE_WRITE_CONSUME = { scope: "profile-write", subject: GATEWAY_USER_ID, limit: 60, windowSeconds: 3600 };
const AUTHORIZATION = ["auth.currentUser", "rateLimiter.consume", "profiles.getOwn"];

type Overrides = {
  auth?: FakeAuthGatewayOptions;
  limiter?: FakeRateLimiterOptions;
  profiles?: FakeProfileReaderOptions;
  availability?: FakeAvailabilityRepositoryOptions;
  now?: string;
};

function harness(overrides: Overrides = {}) {
  const log = makeCallLog();
  const deps = {
    auth: fakeAuthGateway({ log, currentUser: AUTHENTICATED, ...overrides.auth }),
    rateLimiter: fakeRateLimiter({ log, ...overrides.limiter }),
    profiles: fakeProfileReader({ log, ...overrides.profiles }),
    availability: fakeAvailabilityRepository({ log, ...overrides.availability }),
  };
  return {
    log,
    saveTimeZone: makeSaveTimeZone(deps),
    replaceAvailabilityRules: makeReplaceAvailabilityRules(deps),
    addAvailabilityException: makeAddAvailabilityException({ ...deps, clock: fixedClock(overrides.now ?? SETTINGS_NOW) }),
    removeAvailabilityException: makeRemoveAvailabilityException(deps),
  };
}

type Harness = ReturnType<typeof harness>;

const WRITES: ReadonlyArray<readonly [string, (h: Harness) => Promise<unknown>]> = [
  ["saveTimeZone", (h) => h.saveTimeZone("America/New_York")],
  ["replaceAvailabilityRules", (h) => h.replaceAvailabilityRules(aWorkingWeek())],
  ["addAvailabilityException", (h) => h.addAvailabilityException(anExceptionInput())],
  ["removeAvailabilityException", (h) => h.removeAvailabilityException(EXCEPTION_IDS[0])],
];

describe("authorization in every availability use case (decision 1, criterion 2)", () => {
  it.each(WRITES)("%s: no session → err('unauthenticated'), nothing consumed, read nor written", async (_name, call) => {
    const h = harness({ auth: { currentUser: ok(null) } });

    expect(await call(h)).toStrictEqual(err("unauthenticated"));
    expect(h.log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it.each(WRITES)("%s: profile-write exhausted → err('rate_limited') before any read or write", async (_name, call) => {
    const h = harness({ limiter: { deny: ["profile-write"] } });

    expect(await call(h)).toStrictEqual(err("rate_limited"));
    expect(h.log.sequence()).toStrictEqual(["auth.currentUser", "rateLimiter.consume"]);
    expect(h.log.inputsOf("rateLimiter", "consume")).toStrictEqual([PROFILE_WRITE_CONSUME]);
  });

  it.each(WRITES)("%s: rate limiter unavailable → err('unexpected') (fail closed)", async (_name, call) => {
    const h = harness({ limiter: { failing: true } });

    expect(await call(h)).toStrictEqual(err("unexpected"));
  });

  it.each(WRITES)("%s: an account without carnet profile (another project) → err('not_found'), nothing touched", async (_name, call) => {
    const h = harness({ profiles: { results: [ok(null)] } });

    expect(await call(h)).toStrictEqual(err("not_found"));
    expect(h.log.sequence()).toStrictEqual(AUTHORIZATION);
  });

  it.each(WRITES)("%s: the repository always receives the profile id read by getOwn", async (_name, call) => {
    const h = harness();

    await call(h);

    const repositoryCalls = h.log.entries.filter((entry) => entry.port === "availability");
    expect(repositoryCalls.length).toBeGreaterThan(0);
    for (const entry of repositoryCalls) {
      expect((entry.input as { profileId: string }).profileId).toBe(PROFILE_ID);
    }
  });
});

describe("saveTimeZone — ADR 0016 §2, note of 0036 (Intl list only)", () => {
  it("a zone of the Intl list → authorize → setTimeZone → ok", async () => {
    const h = harness();

    expect(await h.saveTimeZone("America/New_York")).toStrictEqual(ok(undefined));
    expect(h.log.sequence()).toStrictEqual([...AUTHORIZATION, "availability.setTimeZone"]);
    expect(h.log.inputsOf("availability", "setTimeZone")).toStrictEqual([{ profileId: PROFILE_ID, timeZone: "America/New_York" }]);
  });

  it.each(["Mars/Olympus", "europe/paris", "US/Eastern", "EST5EDT", "+02:00", ""])(
    "%j is refused → err('invalid_input') before anything is called",
    async (zone) => {
      const h = harness();

      expect(await h.saveTimeZone(zone)).toStrictEqual(err("invalid_input"));
      expect(h.log.sequence()).toStrictEqual([]);
    },
  );

  it("replayed: the same zone twice → ok twice, the same full write", async () => {
    const h = harness();

    expect(await h.saveTimeZone("Asia/Tokyo")).toStrictEqual(ok(undefined));
    expect(await h.saveTimeZone("Asia/Tokyo")).toStrictEqual(ok(undefined));
    expect(h.log.inputsOf("availability", "setTimeZone")).toStrictEqual([
      { profileId: PROFILE_ID, timeZone: "Asia/Tokyo" },
      { profileId: PROFILE_ID, timeZone: "Asia/Tokyo" },
    ]);
  });

  it.each(["not_found", "invalid_input", "unexpected"] as const)("setTimeZone answers %s → err(%j)", async (error) => {
    const h = harness({ availability: { setTimeZone: [err(error)] } });

    expect(await h.saveTimeZone("Asia/Tokyo")).toStrictEqual(err(error));
  });
});

describe("replaceAvailabilityRules — decision 1 (idempotent replacement of the list)", () => {
  it("forwards the full list once → ok(stored rules)", async () => {
    const h = harness();

    expect(await h.replaceAvailabilityRules(aWorkingWeek())).toStrictEqual(ok(aWorkingWeek()));
    expect(h.log.sequence()).toStrictEqual([...AUTHORIZATION, "availability.replaceRules"]);
    expect(h.log.inputsOf("availability", "replaceRules")).toStrictEqual([{ profileId: PROFILE_ID, rules: aWorkingWeek() }]);
  });

  it("an empty list is forwarded as is (every rule removed)", async () => {
    const h = harness();

    expect(await h.replaceAvailabilityRules([])).toStrictEqual(ok([]));
    expect(h.log.inputsOf("availability", "replaceRules")).toStrictEqual([{ profileId: PROFILE_ID, rules: [] }]);
  });

  it("idempotence, executed twice: the same list gives the same result", async () => {
    const h = harness();

    const first = await h.replaceAvailabilityRules(aWorkingWeek());
    const second = await h.replaceAvailabilityRules(aWorkingWeek());

    expect(second).toStrictEqual(first);
    expect(h.log.inputsOf("availability", "replaceRules")).toHaveLength(2);
  });

  it.each([
    ["42501 (another account's profile)", "not_found"],
    ["23P01 (overlapping rules)", "overlap"],
    ["CN004 of the 50-rule cap", "limit_reached"],
    ["23514 / 22023 (bounds, minutes)", "invalid_input"],
    ["anything else", "unexpected"],
  ] as const)("replaceRules answers %s → err(%j)", async (_label, error) => {
    const h = harness({ availability: { replaceRules: [err(error)] } });

    expect(await h.replaceAvailabilityRules(aWorkingWeek())).toStrictEqual(err(error));
  });
});

describe("addAvailabilityException — criterion 1 (absences, one-off openings)", () => {
  it("converts the local times in the profile's zone (read under the session) and stores the exception with the client id", async () => {
    const h = harness();

    expect(await h.addAvailabilityException(anExceptionInput())).toStrictEqual(ok(anException()));
    expect(h.log.sequence()).toStrictEqual([...AUTHORIZATION, "availability.getTimeZone", "availability.addException"]);
    expect(h.log.inputsOf("availability", "getTimeZone")).toStrictEqual([{ profileId: PROFILE_ID }]);
    expect(h.log.inputsOf("availability", "addException")).toStrictEqual([{ profileId: PROFILE_ID, exception: anException() }]);
  });

  it("the stored zone of the profile is the one used (Asia/Tokyo: 14:00 → 05:00Z)", async () => {
    const h = harness({ availability: { timeZone: [ok(zone("Asia/Tokyo"))] } });

    await h.addAvailabilityException(anExceptionInput({ start: "2026-12-24T14:00", end: "2026-12-24T18:00" }));

    expect(h.log.inputsOf("availability", "addException")).toStrictEqual([
      {
        profileId: PROFILE_ID,
        exception: anException({ startsAt: "2026-12-24T05:00:00.000Z", endsAt: "2026-12-24T09:00:00.000Z" }),
      },
    ]);
  });

  it("a one-off opening (extra) is stored as such", async () => {
    const h = harness();

    expect(await h.addAvailabilityException(anExceptionInput({ kind: "extra" }))).toStrictEqual(ok(anException({ kind: "extra" })));
  });

  it.each([
    ["an unknown kind", { kind: "holiday" }, "invalid_kind"],
    ["a malformed start", { start: "24/12/2026 14:00" }, "invalid_start"],
    ["a malformed end", { end: "" }, "invalid_end"],
    ["an end before the start", { end: "2026-12-24T13:00" }, "invalid_range"],
    ["an exception already over (injected clock)", { start: "2026-11-01T09:00", end: "2026-11-18T11:00" }, "already_ended"],
  ] as const)("%s → err(%j), nothing written", async (_label, input, error) => {
    const h = harness();

    expect(await h.addAvailabilityException(anExceptionInput(input))).toStrictEqual(err(error));
    expect(h.log.inputsOf("availability", "addException")).toStrictEqual([]);
  });

  it("the clock is injected: the same input is accepted one minute before its end", async () => {
    const h = harness({ now: "2026-11-18T09:59:00.000Z" });

    const result = await h.addAvailabilityException(anExceptionInput({ start: "2026-11-01T09:00", end: "2026-11-18T11:00" }));

    expect(result.ok).toBe(true);
  });

  it("idempotence, executed twice: the same id and input → the same result (the repository keeps one row)", async () => {
    const h = harness();

    const first = await h.addAvailabilityException(anExceptionInput());
    const second = await h.addAvailabilityException(anExceptionInput());

    expect(second).toStrictEqual(first);
    expect(h.log.inputsOf("availability", "addException")).toStrictEqual([
      { profileId: PROFILE_ID, exception: anException() },
      { profileId: PROFILE_ID, exception: anException() },
    ]);
  });

  it("getTimeZone answers not_found → err('not_found'), nothing written", async () => {
    const h = harness({ availability: { timeZone: [err("not_found")] } });

    expect(await h.addAvailabilityException(anExceptionInput())).toStrictEqual(err("not_found"));
    expect(h.log.inputsOf("availability", "addException")).toStrictEqual([]);
  });

  it("getTimeZone fails → err('unexpected'), nothing written", async () => {
    const h = harness({ availability: { timeZone: [err("unexpected")] } });

    expect(await h.addAvailabilityException(anExceptionInput())).toStrictEqual(err("unexpected"));
    expect(h.log.inputsOf("availability", "addException")).toStrictEqual([]);
  });

  it.each(["not_found", "limit_reached", "invalid_input", "unexpected"] as const)(
    "addException answers %s → err(%j) (200 upcoming exceptions: limit_reached)",
    async (error) => {
      const h = harness({ availability: { addException: [err(error)] } });

      expect(await h.addAvailabilityException(anExceptionInput())).toStrictEqual(err(error));
    },
  );
});

describe("removeAvailabilityException — criterion 1", () => {
  it("removes the caller's exception → ok", async () => {
    const h = harness();

    expect(await h.removeAvailabilityException(EXCEPTION_IDS[1])).toStrictEqual(ok(undefined));
    expect(h.log.sequence()).toStrictEqual([...AUTHORIZATION, "availability.removeException"]);
    expect(h.log.inputsOf("availability", "removeException")).toStrictEqual([{ profileId: PROFILE_ID, id: EXCEPTION_IDS[1] }]);
  });

  it("idempotence, executed twice: already removed → ok both times", async () => {
    const h = harness();

    expect(await h.removeAvailabilityException(EXCEPTION_IDS[1])).toStrictEqual(ok(undefined));
    expect(await h.removeAvailabilityException(EXCEPTION_IDS[1])).toStrictEqual(ok(undefined));
  });

  it("removeException fails → err('unexpected')", async () => {
    const h = harness({ availability: { removeException: [err("unexpected")] } });

    expect(await h.removeAvailabilityException(EXCEPTION_IDS[1])).toStrictEqual(err("unexpected"));
  });
});
