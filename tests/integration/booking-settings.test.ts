/**
 * 0038 — criteria 1 and 2 against the local Supabase stack (schema of 0036; PostgREST max_rows = 100 as on the shared
 * instance). Real adapters under the session client of each persona, real use cases; fixtures and checks behind the
 * application through service_role.
 *
 * Adapters under test (contract frozen by test-engineer; ports in src/server/booking/use-cases/*.test.ts):
 * // src/server/booking/repositories/supabase-event-type-repository.ts
 * // makeSupabaseEventTypeRepository(server: CarnetClient): EventTypeRepository — session client only.
 * // src/server/booking/repositories/supabase-availability-repository.ts
 * // makeSupabaseAvailabilityRepository(server: CarnetClient): AvailabilityRepository — session client only.
 * // Both: log the SQLSTATE only (logInfrastructureError), never the Postgres message or details.
 * // Proposed SQL functions (db-architect, security invoker, execute to authenticated only, pgTAP in
 * // supabase/tests/carnet_booking_settings_functions.test.sql):
 * //   carnet.replace_availability_rules(p_profile_id uuid, p_rules jsonb) returns setof carnet.availability_rules
 * //   carnet.reorder_event_types(p_profile_id uuid, p_ids uuid[]) returns setof carnet.event_types
 */
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import type { AvailabilityRule } from "@/domain/booking/availability";
import type { EventTypeDraft } from "@/domain/booking/event-type";
import { err, ok } from "@/domain/shared/result";
import { makeSupabaseAvailabilityRepository } from "@/server/booking/repositories/supabase-availability-repository";
import { makeSupabaseEventTypeRepository } from "@/server/booking/repositories/supabase-event-type-repository";
import { makeAddAvailabilityException } from "@/server/booking/use-cases/add-availability-exception";
import { makeCreateEventType } from "@/server/booking/use-cases/create-event-type";
import { makeDeleteEventType } from "@/server/booking/use-cases/delete-event-type";
import { makeGetBookingSettings } from "@/server/booking/use-cases/get-booking-settings";
import { makeRemoveAvailabilityException } from "@/server/booking/use-cases/remove-availability-exception";
import { makeReorderEventTypes } from "@/server/booking/use-cases/reorder-event-types";
import { makeReplaceAvailabilityRules } from "@/server/booking/use-cases/replace-availability-rules";
import { makeSaveTimeZone } from "@/server/booking/use-cases/save-time-zone";
import { makeSetEventTypeActive } from "@/server/booking/use-cases/set-event-type-active";
import { makeUpdateEventType } from "@/server/booking/use-cases/update-event-type";
import { makeSupabaseAuthGateway } from "@/server/infrastructure/supabase/auth-gateway";
import { makeSupabaseProfileReader } from "@/server/repositories/supabase-profile-reader";
import { makeSupabaseRateLimiter } from "@/server/repositories/supabase-rate-limiter";

import { aRule, aWorkingWeek, anEventTypeDraft } from "../builders/booking-settings";
import {
  bookingStatusOf,
  eventTypesOf,
  exceptionsOf,
  insertBooking,
  insertUpcomingExceptions,
  localInDays,
  minutesAfter,
  rulesOf,
  timeZoneOf,
} from "./setup/booking-settings";
import { deleteUsersByEmail } from "./setup/cleanup";
import { adminClient, anonClient, type CarnetClient } from "./setup/clients";
import { RUN_SECRET } from "./setup/fixtures";
import { createMember, createOutsider, type Member } from "./setup/members";

/** "Now" of the suite, captured once: the database compares with its own now(), so every date is far from it. */
const NOW = new Date();

function mediaOrigin(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (value === undefined) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL missing (globalSetup)");
  }
  return value;
}

const IN_PERSON = anEventTypeDraft({
  title: "Rendez-vous à l'atelier",
  durationMin: 60,
  bufferMin: 15,
  minNoticeMin: 1440,
  locationKind: "in_person",
  locationText: "12 rue des Lilas, 69003 Lyon",
});

/** 50 distinct rules: seven weekdays × half-hour plages from 00:00. */
function fiftyRules(): AvailabilityRule[] {
  return Array.from({ length: 50 }, (_, index) => {
    const hour = String(Math.floor(index / 7)).padStart(2, "0");
    return aRule({ weekday: ((index % 7) + 1) as AvailabilityRule["weekday"], start: `${hour}:00`, end: `${hour}:30` });
  }).sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
}

describe("booking settings against the local Supabase stack (0038)", () => {
  const admin = adminClient();
  const emails: string[] = [];

  function track(email: string): string {
    emails.push(email);
    return email;
  }

  function casesOf(session: CarnetClient) {
    const deps = {
      auth: makeSupabaseAuthGateway(session),
      rateLimiter: makeSupabaseRateLimiter(admin, RUN_SECRET),
      profiles: makeSupabaseProfileReader(session, mediaOrigin()),
      eventTypes: makeSupabaseEventTypeRepository(session),
      availability: makeSupabaseAvailabilityRepository(session),
    };
    const clock = { now: () => NOW };
    return {
      eventTypes: deps.eventTypes,
      availability: deps.availability,
      getBookingSettings: makeGetBookingSettings({ ...deps, clock }),
      saveTimeZone: makeSaveTimeZone(deps),
      createEventType: makeCreateEventType(deps),
      updateEventType: makeUpdateEventType(deps),
      setEventTypeActive: makeSetEventTypeActive(deps),
      reorderEventTypes: makeReorderEventTypes(deps),
      deleteEventType: makeDeleteEventType(deps),
      replaceAvailabilityRules: makeReplaceAvailabilityRules(deps),
      addAvailabilityException: makeAddAvailabilityException({ ...deps, clock }),
      removeAvailabilityException: makeRemoveAvailabilityException(deps),
    };
  }

  async function create(member: Member, draft: EventTypeDraft = anEventTypeDraft()): Promise<string> {
    const id = randomUUID();
    const created = await casesOf(member.session).createEventType({ id, ...draft });
    if (!created.ok) {
      throw new Error(`createEventType failed: ${created.error}`);
    }
    return id;
  }

  /** A member with one type, a working week and one upcoming absence. */
  async function ownerWithSettings(): Promise<{ member: Member; typeId: string; exceptionId: string }> {
    const member = await createMember(admin, track);
    const cases = casesOf(member.session);
    const typeId = await create(member);
    expect(await cases.replaceAvailabilityRules(aWorkingWeek())).toMatchObject({ ok: true });
    const exceptionId = randomUUID();
    const added = await cases.addAvailabilityException({
      id: exceptionId,
      kind: "busy",
      start: localInDays(NOW, 20, "09:00"),
      end: localInDays(NOW, 22, "18:00"),
    });
    expect(added.ok).toBe(true);
    return { member, typeId, exceptionId };
  }

  afterEach(async () => {
    const { survivingProfileIds } = await deleteUsersByEmail(admin, emails.splice(0));

    expect(survivingProfileIds).toStrictEqual([]);
  });

  describe("criterion 1: identical reading", () => {
    it("a new profile reads Europe/Paris and empty lists", async () => {
      const member = await createMember(admin, track);

      expect(await casesOf(member.session).getBookingSettings()).toStrictEqual(
        ok({ timeZone: "Europe/Paris", eventTypes: [], rules: [], exceptions: [] }),
      );
    });

    it("time zone, types (created, modified, deactivated, reordered), rules and exceptions read back exactly as written", async () => {
      const member = await createMember(admin, track);
      const cases = casesOf(member.session);

      expect(await cases.saveTimeZone("America/New_York")).toStrictEqual(ok(undefined));
      const video = await create(member);
      const phone = await create(member, anEventTypeDraft({ title: "Appel", locationKind: "phone", locationText: null }));
      expect(await cases.updateEventType({ id: phone, ...IN_PERSON })).toMatchObject({ ok: true });
      expect(await cases.setEventTypeActive({ id: video, isActive: false })).toMatchObject({ ok: true });
      expect(await cases.reorderEventTypes([phone, video])).toMatchObject({ ok: true });
      const week = [...aWorkingWeek(), aRule({ weekday: 6, start: "20:00", end: "24:00" })];
      expect(await cases.replaceAvailabilityRules(week)).toStrictEqual(ok(week));
      const busy = await cases.addAvailabilityException({
        id: randomUUID(),
        kind: "busy",
        start: localInDays(NOW, 30, "14:00", "America/New_York"),
        end: localInDays(NOW, 32, "00:00", "America/New_York"),
      });
      const extra = await cases.addAvailabilityException({
        id: randomUUID(),
        kind: "extra",
        start: localInDays(NOW, 10, "07:00", "America/New_York"),
        end: localInDays(NOW, 10, "08:30", "America/New_York"),
      });
      if (!busy.ok || !extra.ok) {
        throw new Error("addAvailabilityException failed");
      }

      expect(await cases.getBookingSettings()).toStrictEqual(
        ok({
          timeZone: "America/New_York",
          eventTypes: [
            { id: phone, ...IN_PERSON, isActive: true, position: 0 },
            { id: video, ...anEventTypeDraft(), isActive: false, position: 1 },
          ],
          rules: week,
          exceptions: [extra.value, busy.value],
        }),
      );
      expect(await timeZoneOf(admin, member.profileId)).toBe("America/New_York");
      expect(await rulesOf(admin, member.profileId)).toContainEqual({ weekday: 6, start_time: "20:00:00", end_time: "24:00:00" });
    });

    it("an exception is stored at the instants of the profile's time zone (America/New_York, UTC−5 in winter)", async () => {
      const member = await createMember(admin, track);
      const cases = casesOf(member.session);
      await cases.saveTimeZone("America/New_York");
      const start = localInDays(NOW, 40, "14:00", "America/New_York");
      const end = localInDays(NOW, 40, "18:00", "America/New_York");
      const expectedStart = Temporal.PlainDateTime.from(start).toZonedDateTime("America/New_York").toInstant();
      const expectedEnd = Temporal.PlainDateTime.from(end).toZonedDateTime("America/New_York").toInstant();

      const added = await cases.addAvailabilityException({ id: randomUUID(), kind: "busy", start, end });

      expect(added.ok).toBe(true);
      expect(await exceptionsOf(admin, member.profileId)).toStrictEqual([
        {
          id: added.ok ? added.value.id : "",
          kind: "busy",
          startsAt: new Date(expectedStart.epochMilliseconds).toISOString(),
          endsAt: new Date(expectedEnd.epochMilliseconds).toISOString(),
        },
      ]);
    });

    it("note of 0036: reordering swaps positions in one statement (positions unique, 0 ↔ 1)", async () => {
      const member = await createMember(admin, track);
      const first = await create(member);
      const second = await create(member, IN_PERSON);

      const reordered = await casesOf(member.session).reorderEventTypes([second, first]);

      expect(reordered).toMatchObject({ ok: true });
      expect((await eventTypesOf(admin, member.profileId)).map(({ id, position }) => ({ id, position }))).toStrictEqual([
        { id: second, position: 0 },
        { id: first, position: 1 },
      ]);
    });

    it("decision 3: ten types at most; a deleted type frees its position for the next creation", async () => {
      const member = await createMember(admin, track);
      const cases = casesOf(member.session);
      const ids: string[] = [];
      for (let index = 0; index < 10; index += 1) {
        ids.push(await create(member, anEventTypeDraft({ title: `Type ${index}` })));
      }

      expect(await cases.createEventType({ id: randomUUID(), ...anEventTypeDraft() })).toStrictEqual(err("limit_reached"));
      expect(await eventTypesOf(admin, member.profileId)).toHaveLength(10);

      expect(await cases.deleteEventType(ids[3] ?? "")).toStrictEqual(ok(undefined));
      const replacement = randomUUID();
      const created = await cases.createEventType({ id: replacement, ...anEventTypeDraft({ title: "Remplaçant" }) });

      expect(created).toMatchObject({ ok: true, value: { id: replacement, position: 3 } });
    });

    it("note of 0036: a type with bookings cannot be deleted → has_bookings; deactivated instead, its booking kept", async () => {
      const member = await createMember(admin, track);
      const cases = casesOf(member.session);
      const typeId = await create(member);
      const bookingId = await insertBooking(admin, member.profileId, typeId, minutesAfter(NOW, 7 * 24 * 60));

      expect(await cases.deleteEventType(typeId)).toStrictEqual(err("has_bookings"));
      expect(await eventTypesOf(admin, member.profileId)).toHaveLength(1);

      expect(await cases.setEventTypeActive({ id: typeId, isActive: false })).toMatchObject({ ok: true, value: { isActive: false } });
      expect(await bookingStatusOf(admin, bookingId)).toBe("confirmed");
    });
  });

  describe("idempotence: every replayable operation executed twice", () => {
    it("createEventType with the same id → the same type, one row", async () => {
      const member = await createMember(admin, track);
      const cases = casesOf(member.session);
      const command = { id: randomUUID(), ...anEventTypeDraft() };

      const first = await cases.createEventType(command);
      const second = await cases.createEventType(command);

      expect(first).toMatchObject({ ok: true });
      expect(second).toStrictEqual(first);
      expect(await eventTypesOf(admin, member.profileId)).toHaveLength(1);
    });

    it("replaceAvailabilityRules with the same list → the same rules, no duplicate", async () => {
      const member = await createMember(admin, track);
      const cases = casesOf(member.session);

      const first = await cases.replaceAvailabilityRules(aWorkingWeek());
      const second = await cases.replaceAvailabilityRules(aWorkingWeek());

      expect(first).toStrictEqual(ok(aWorkingWeek()));
      expect(second).toStrictEqual(first);
      expect(await rulesOf(admin, member.profileId)).toHaveLength(10);
    });

    it("addAvailabilityException with the same id → the same exception, one row", async () => {
      const member = await createMember(admin, track);
      const cases = casesOf(member.session);
      const input = { id: randomUUID(), kind: "busy", start: localInDays(NOW, 5, "09:00"), end: localInDays(NOW, 5, "12:00") };

      const first = await cases.addAvailabilityException(input);
      const second = await cases.addAvailabilityException(input);

      expect(first).toMatchObject({ ok: true });
      expect(second).toStrictEqual(first);
      expect(await exceptionsOf(admin, member.profileId)).toHaveLength(1);
    });

    it("updateEventType, setEventTypeActive, reorderEventTypes and saveTimeZone twice → the same state", async () => {
      const member = await createMember(admin, track);
      const cases = casesOf(member.session);
      const a = await create(member);
      const b = await create(member, IN_PERSON);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        expect(await cases.updateEventType({ id: a, ...anEventTypeDraft({ title: "Renommé" }) })).toMatchObject({ ok: true });
        expect(await cases.setEventTypeActive({ id: b, isActive: false })).toMatchObject({ ok: true });
        expect(await cases.reorderEventTypes([b, a])).toMatchObject({ ok: true });
        expect(await cases.saveTimeZone("Asia/Tokyo")).toStrictEqual(ok(undefined));
      }

      expect((await eventTypesOf(admin, member.profileId)).map(({ id, title, is_active, position }) => ({ id, title, is_active, position }))).toStrictEqual([
        { id: b, title: IN_PERSON.title, is_active: false, position: 0 },
        { id: a, title: "Renommé", is_active: true, position: 1 },
      ]);
      expect(await timeZoneOf(admin, member.profileId)).toBe("Asia/Tokyo");
    });

    it("deleteEventType and removeAvailabilityException twice → ok twice, gone", async () => {
      const { member, typeId, exceptionId } = await ownerWithSettings();
      const cases = casesOf(member.session);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        expect(await cases.deleteEventType(typeId)).toStrictEqual(ok(undefined));
        expect(await cases.removeAvailabilityException(exceptionId)).toStrictEqual(ok(undefined));
      }

      expect(await eventTypesOf(admin, member.profileId)).toStrictEqual([]);
      expect(await exceptionsOf(admin, member.profileId)).toStrictEqual([]);
    });
  });

  describe("database refusals translated (23514, CN004, 23P01, 23503) — repositories under the session", () => {
    it("23P01: overlapping rules reaching the database → overlap; the previous rules are kept (one transaction)", async () => {
      const member = await createMember(admin, track);
      const { availability } = casesOf(member.session);
      await casesOf(member.session).replaceAvailabilityRules(aWorkingWeek());

      const refused = await availability.replaceRules(member.profileId, [
        aRule({ start: "09:00", end: "12:00" }),
        aRule({ start: "11:00", end: "13:00" }),
      ]);

      expect(refused).toStrictEqual(err("overlap"));
      expect(await availability.listRules(member.profileId)).toStrictEqual(ok(aWorkingWeek()));
    });

    it("point 17 and 0038 point 6: 50 rules are accepted; 51 → CN004 from the database, limit_reached, the previous rules kept", async () => {
      const member = await createMember(admin, track);
      const { availability } = casesOf(member.session);

      expect(await availability.replaceRules(member.profileId, fiftyRules())).toStrictEqual(ok(fiftyRules()));
      const raw = await member.session.rpc("replace_availability_rules", {
        p_profile_id: member.profileId,
        p_rules: [...fiftyRules(), aRule({ weekday: 7, start: "23:00", end: "23:30" })].map(({ weekday, start, end }) => ({
          weekday,
          start_time: start,
          end_time: end,
        })),
      });
      expect(raw.error?.code, "SQLSTATE of the cap trigger").toBe("CN004");
      const refused = await availability.replaceRules(member.profileId, [
        ...fiftyRules(),
        aRule({ weekday: 7, start: "23:00", end: "23:30" }),
      ]);

      expect(refused).toStrictEqual(err("limit_reached"));
      expect(await rulesOf(admin, member.profileId)).toHaveLength(50);
    });

    it("23514 on a rule (seconds are impossible through the domain, so a 4-minute plage) → invalid_input, previous rules kept", async () => {
      const member = await createMember(admin, track);
      const { availability } = casesOf(member.session);
      await casesOf(member.session).replaceAvailabilityRules(aWorkingWeek());

      expect(await availability.replaceRules(member.profileId, [aRule({ start: "09:00", end: "09:04" })])).toStrictEqual(
        err("invalid_input"),
      );
      expect(await rulesOf(admin, member.profileId)).toHaveLength(10);
    });

    it("point 17 and 0038 point 6: 200 upcoming exceptions → the 201st is refused (CN004 from the database, limit_reached), nothing added", async () => {
      const member = await createMember(admin, track);
      await insertUpcomingExceptions(admin, member.profileId, minutesAfter(NOW, 2 * 24 * 60), 200);
      const startsAt = minutesAfter(NOW, 50 * 24 * 60);
      const raw = await member.session.from("availability_exceptions").insert({
        id: randomUUID(),
        profile_id: member.profileId,
        kind: "extra",
        range: `[${startsAt.toISOString()},${minutesAfter(startsAt, 60).toISOString()})`,
      });
      expect(raw.error?.code, "SQLSTATE of the cap trigger").toBe("CN004");

      const refused = await casesOf(member.session).addAvailabilityException({
        id: randomUUID(),
        kind: "extra",
        start: localInDays(NOW, 50, "09:00"),
        end: localInDays(NOW, 50, "10:00"),
      });

      expect(refused).toStrictEqual(err("limit_reached"));
      expect(await exceptionsOf(admin, member.profileId)).toHaveLength(200);
    });

    it("23514 on an event type reaching the database (duration 4) → invalid_input, nothing written", async () => {
      const member = await createMember(admin, track);
      const { eventTypes } = casesOf(member.session);

      const refused = await eventTypes.create(member.profileId, { id: randomUUID(), position: 0, ...anEventTypeDraft({ durationMin: 4 }) });

      expect(refused).toStrictEqual(err("invalid_input"));
      expect(await eventTypesOf(admin, member.profileId)).toStrictEqual([]);
    });

    it("23514 on the time zone (a name outside pg_timezone_names) → invalid_input, unchanged", async () => {
      const member = await createMember(admin, track);

      expect(await casesOf(member.session).availability.setTimeZone(member.profileId, "Mars/Olympus")).toStrictEqual(err("invalid_input"));
      expect(await timeZoneOf(admin, member.profileId)).toBe("Europe/Paris");
    });

    it("note of 0036: every zone of Intl.supportedValuesOf('timeZone') is accepted by the database (is_valid_time_zone)", async () => {
      const member = await createMember(admin, track);
      const refused: string[] = [];
      for (const zone of Intl.supportedValuesOf("timeZone")) {
        const { data, error } = await member.session.rpc("is_valid_time_zone", { p_value: zone });
        if (error !== null || data !== true) {
          refused.push(zone);
        }
      }

      expect(refused).toStrictEqual([]);
    });
  });

  describe("PostgREST row limit (docs/rules/supabase.md)", () => {
    it("150 upcoming exceptions are all read back, by start", async () => {
      const member = await createMember(admin, track);
      await insertUpcomingExceptions(admin, member.profileId, minutesAfter(NOW, 3 * 24 * 60), 150);

      const settings = await casesOf(member.session).getBookingSettings();

      expect(settings.ok).toBe(true);
      const exceptions = settings.ok ? settings.value.exceptions : [];
      expect(exceptions).toHaveLength(150);
      const starts = exceptions.map((exception) => exception.startsAt);
      expect(starts).toStrictEqual([...starts].sort());
    });
  });

  describe("criterion 2: another account reads and modifies nothing", () => {
    it("another carnet member: own settings empty, A's types, rules and exceptions untouched by its use cases", async () => {
      const { member: owner, typeId, exceptionId } = await ownerWithSettings();
      const before = await casesOf(owner.session).getBookingSettings();
      const other = await createMember(admin, track);
      const cases = casesOf(other.session);

      expect(await cases.getBookingSettings()).toStrictEqual(ok({ timeZone: "Europe/Paris", eventTypes: [], rules: [], exceptions: [] }));
      expect(await cases.updateEventType({ id: typeId, ...anEventTypeDraft({ title: "Piraté" }) })).toStrictEqual(err("not_found"));
      expect(await cases.setEventTypeActive({ id: typeId, isActive: false })).toStrictEqual(err("not_found"));
      expect(await cases.reorderEventTypes([typeId])).toStrictEqual(err("conflict"));
      expect(await cases.deleteEventType(typeId)).toStrictEqual(ok(undefined));
      expect(await cases.removeAvailabilityException(exceptionId)).toStrictEqual(ok(undefined));
      expect(await cases.createEventType({ id: typeId, ...anEventTypeDraft() })).toStrictEqual(err("conflict"));
      expect(
        await cases.addAvailabilityException({ id: exceptionId, kind: "busy", start: localInDays(NOW, 3, "09:00"), end: localInDays(NOW, 3, "10:00") }),
      ).toStrictEqual(err("invalid_input"));

      expect(await casesOf(owner.session).getBookingSettings()).toStrictEqual(before);
      expect(await eventTypesOf(admin, other.profileId)).toStrictEqual([]);
      expect(await exceptionsOf(admin, other.profileId)).toStrictEqual([]);
    });

    it("another carnet member calling the repositories with A's profile id: reads nothing, every write refused", async () => {
      const { member: owner, typeId } = await ownerWithSettings();
      const before = await casesOf(owner.session).getBookingSettings();
      const { eventTypes, availability } = casesOf((await createMember(admin, track)).session);

      expect(await eventTypes.listOwn(owner.profileId)).toStrictEqual(ok([]));
      expect(await availability.listRules(owner.profileId)).toStrictEqual(ok([]));
      expect(await availability.listUpcomingExceptions(owner.profileId, NOW)).toStrictEqual(ok([]));
      expect(await availability.getTimeZone(owner.profileId)).toStrictEqual(err("not_found"));
      expect(await availability.setTimeZone(owner.profileId, "Asia/Tokyo")).toStrictEqual(err("not_found"));
      expect(await eventTypes.create(owner.profileId, { id: randomUUID(), position: 5, ...anEventTypeDraft() })).toStrictEqual(err("not_found"));
      expect(await eventTypes.update(owner.profileId, typeId, anEventTypeDraft({ title: "Piraté" }))).toStrictEqual(err("not_found"));
      expect(await eventTypes.setActive(owner.profileId, typeId, false)).toStrictEqual(err("not_found"));
      expect(await eventTypes.reorder(owner.profileId, [typeId])).toStrictEqual(err("not_found"));
      expect(await eventTypes.remove(owner.profileId, typeId)).toStrictEqual(ok(undefined));
      expect(await availability.replaceRules(owner.profileId, [])).toStrictEqual(err("not_found"));
      expect(
        await availability.addException(owner.profileId, {
          id: randomUUID(),
          kind: "busy",
          startsAt: minutesAfter(NOW, 600).toISOString(),
          endsAt: minutesAfter(NOW, 660).toISOString(),
        }),
      ).toStrictEqual(err("not_found"));

      expect(await casesOf(owner.session).getBookingSettings()).toStrictEqual(before);
      expect(await timeZoneOf(admin, owner.profileId)).toBe("Europe/Paris");
    });

    it("an account of another project (no carnet profile): no_profile / not_found, nothing read nor written", async () => {
      const { member: owner, typeId } = await ownerWithSettings();
      const before = await casesOf(owner.session).getBookingSettings();
      const outsider = await createOutsider(admin, track);
      const cases = casesOf(outsider.session);

      expect(await cases.getBookingSettings()).toStrictEqual(err("no_profile"));
      expect(await cases.createEventType({ id: randomUUID(), ...anEventTypeDraft() })).toStrictEqual(err("not_found"));
      expect(await cases.replaceAvailabilityRules(aWorkingWeek())).toStrictEqual(err("not_found"));
      expect(await cases.saveTimeZone("Asia/Tokyo")).toStrictEqual(err("not_found"));
      expect(await cases.eventTypes.listOwn(owner.profileId)).toStrictEqual(ok([]));
      expect(await cases.availability.listRules(owner.profileId)).toStrictEqual(ok([]));
      expect(await cases.eventTypes.update(owner.profileId, typeId, anEventTypeDraft({ title: "Piraté" }))).toStrictEqual(err("not_found"));
      expect(await cases.availability.replaceRules(owner.profileId, [])).toStrictEqual(err("not_found"));

      expect(await casesOf(owner.session).getBookingSettings()).toStrictEqual(before);
    });

    it("no session at all: unauthenticated, nothing written", async () => {
      const { member: owner } = await ownerWithSettings();
      const before = await casesOf(owner.session).getBookingSettings();
      const cases = casesOf(anonClient());

      expect(await cases.getBookingSettings()).toStrictEqual(err("unauthenticated"));
      expect(await cases.createEventType({ id: randomUUID(), ...anEventTypeDraft() })).toStrictEqual(err("unauthenticated"));
      expect(await cases.replaceAvailabilityRules([])).toStrictEqual(err("unauthenticated"));
      expect(await cases.availability.replaceRules(owner.profileId, [])).toStrictEqual(err("not_found"));

      expect(await casesOf(owner.session).getBookingSettings()).toStrictEqual(before);
    });
  });
});
