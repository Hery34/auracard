/**
 * Contract frozen by test-engineer (0038, criterion 1 « relecture identique », criterion 2).
 *
 * // src/server/booking/use-cases/get-booking-settings.ts — read only: no rate limit (as listOwnLeads).
 * export type BookingSettings = {
 *   timeZone: string;
 *   eventTypes: EventType[];                 // by position, inactive ones included
 *   rules: AvailabilityRule[];               // by weekday then start
 *   exceptions: AvailabilityException[];     // not ended at clock.now(), by start
 * };
 * export type GetBookingSettingsError = "unauthenticated" | "no_profile" | "unexpected";
 * export type GetBookingSettings = () => Promise<Result<BookingSettings, GetBookingSettingsError>>;
 * export function makeGetBookingSettings(deps: {
 *   auth: AuthGateway; profiles: ProfileReader; eventTypes: EventTypeRepository; availability: AvailabilityRepository; clock: Clock;
 * }): GetBookingSettings;
 * // currentUser → getOwn → the four reads with the profile id of getOwn (any order, parallel allowed).
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeGetBookingSettings } from "@/server/booking/use-cases/get-booking-settings";

import {
  EVENT_TYPE_IDS,
  EXCEPTION_IDS,
  SETTINGS_NOW,
  aWorkingWeek,
  anEventType,
  anException,
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
import {
  fakeEventTypeRepository,
  type FakeEventTypeRepositoryOptions,
} from "../../../../tests/builders/fake-event-type-repository";
import { fakeProfileReader, type FakeProfileReaderOptions } from "../../../../tests/builders/fake-profile-reader";
import { PROFILE_ID } from "../../../../tests/builders/fake-registrar";
import { fixedClock } from "../../../../tests/builders/stats";

const TYPES = [anEventType(), anEventType({ id: EVENT_TYPE_IDS[1], title: "Ancien type", isActive: false, position: 1 })];
const EXCEPTIONS = [anException(), anException({ id: EXCEPTION_IDS[1], kind: "extra" })];

function harness(
  overrides: {
    auth?: FakeAuthGatewayOptions;
    profiles?: FakeProfileReaderOptions;
    eventTypes?: FakeEventTypeRepositoryOptions;
    availability?: FakeAvailabilityRepositoryOptions;
  } = {},
) {
  const log = makeCallLog();
  const getBookingSettings = makeGetBookingSettings({
    auth: fakeAuthGateway({ log, currentUser: ok({ userId: GATEWAY_USER_ID, email: GATEWAY_USER_EMAIL }), ...overrides.auth }),
    profiles: fakeProfileReader({ log, ...overrides.profiles }),
    eventTypes: fakeEventTypeRepository({ log, list: [ok(TYPES)], ...overrides.eventTypes }),
    availability: fakeAvailabilityRepository({
      log,
      timeZone: [ok(zone("America/New_York"))],
      rules: [ok(aWorkingWeek())],
      exceptions: [ok(EXCEPTIONS)],
      ...overrides.availability,
    }),
    clock: fixedClock(SETTINGS_NOW),
  });
  return { log, getBookingSettings };
}

describe("getBookingSettings — criterion 1 (identical reading)", () => {
  it("returns the time zone, the types (inactive included), the rules and the upcoming exceptions as read", async () => {
    const { getBookingSettings } = harness();

    expect(await getBookingSettings()).toStrictEqual(
      ok({ timeZone: "America/New_York", eventTypes: TYPES, rules: aWorkingWeek(), exceptions: EXCEPTIONS }),
    );
  });

  it("authenticates, reads the own profile, then the four reads with its id and the injected now", async () => {
    const { log, getBookingSettings } = harness();

    await getBookingSettings();

    expect(log.sequence().slice(0, 2)).toStrictEqual(["auth.currentUser", "profiles.getOwn"]);
    expect([...log.sequence().slice(2)].sort()).toStrictEqual([
      "availability.getTimeZone",
      "availability.listRules",
      "availability.listUpcomingExceptions",
      "eventTypes.listOwn",
    ]);
    expect(log.inputsOf("eventTypes", "listOwn")).toStrictEqual([{ profileId: PROFILE_ID }]);
    expect(log.inputsOf("availability", "getTimeZone")).toStrictEqual([{ profileId: PROFILE_ID }]);
    expect(log.inputsOf("availability", "listRules")).toStrictEqual([{ profileId: PROFILE_ID }]);
    expect(log.inputsOf("availability", "listUpcomingExceptions")).toStrictEqual([{ profileId: PROFILE_ID, now: SETTINGS_NOW }]);
  });

  it("read only: never consumes a rate limit, never writes", async () => {
    const { log, getBookingSettings } = harness();

    await getBookingSettings();

    expect(log.sequence().filter((call) => call.startsWith("rateLimiter."))).toStrictEqual([]);
    for (const write of ["create", "update", "setActive", "reorder", "remove", "setTimeZone", "replaceRules", "addException", "removeException"]) {
      expect(log.sequence().some((call) => call.endsWith(`.${write}`)), write).toBe(false);
    }
  });

  it("a profile without anything yet → Europe/Paris and empty lists", async () => {
    const { getBookingSettings } = harness({
      eventTypes: { list: [ok([])] },
      availability: { timeZone: [ok(zone("Europe/Paris"))], rules: [ok([])], exceptions: [ok([])] },
    });

    expect(await getBookingSettings()).toStrictEqual(ok({ timeZone: "Europe/Paris", eventTypes: [], rules: [], exceptions: [] }));
  });
});

describe("getBookingSettings — refusals (criterion 2)", () => {
  it("no session → err('unauthenticated'), nothing read", async () => {
    const { log, getBookingSettings } = harness({ auth: { currentUser: ok(null) } });

    expect(await getBookingSettings()).toStrictEqual(err("unauthenticated"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it("GoTrue unreachable → err('unexpected')", async () => {
    const { log, getBookingSettings } = harness({ auth: { currentUser: err("unexpected") } });

    expect(await getBookingSettings()).toStrictEqual(err("unexpected"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it("an account of another project (no carnet profile) → err('no_profile'), nothing read", async () => {
    const { log, getBookingSettings } = harness({ profiles: { results: [ok(null)] } });

    expect(await getBookingSettings()).toStrictEqual(err("no_profile"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser", "profiles.getOwn"]);
  });

  it.each([
    ["the profile reader", { profiles: { results: [err("unexpected" as const)] } }],
    ["the event types", { eventTypes: { list: [err("unexpected" as const)] } }],
    ["the time zone", { availability: { timeZone: [err("unexpected" as const)] } }],
    ["the rules", { availability: { rules: [err("unexpected" as const)] } }],
    ["the exceptions", { availability: { exceptions: [err("unexpected" as const)] } }],
  ])("%s failing → err('unexpected')", async (_label, overrides) => {
    const { getBookingSettings } = harness(overrides);

    expect(await getBookingSettings()).toStrictEqual(err("unexpected"));
  });

  it("the time zone not visible under the session → err('unexpected')", async () => {
    const { getBookingSettings } = harness({ availability: { timeZone: [err("not_found")] } });

    expect(await getBookingSettings()).toStrictEqual(err("unexpected"));
  });
});
