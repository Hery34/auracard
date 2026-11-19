/**
 * 0039 — criteria 1 to 3 against the local Supabase stack (functions of 0036: get_public_booking_page,
 * get_public_busy_ranges, book_slot; caps of 0038). Real adapters and use cases; the bot challenge verifier is the
 * fake implementation of its port (ADR 0008: Cloudflare is never called by the integration suite). The clock of the
 * reads is the real one (the base compares with its own now()); every slot is chosen relatively to it.
 *
 * Adapters under test (contract frozen by test-engineer, see the unit tests of each one):
 * // src/server/booking/repositories/supabase-public-booking-reader.ts
 * // makeSupabasePublicBookingReader(client: CarnetClient): PublicBookingReader — anonymous client.
 * // src/server/booking/repositories/supabase-slot-booker.ts
 * // makeSupabaseSlotBooker(admin: CarnetClient): SlotBooker — service_role, rpc("book_slot") only.
 *
 * Real concurrency (notes inherited from 0036 and reported from the 0036 audit): two requests sent together reach
 * PostgreSQL through two PostgREST connections, i.e. two transactions. book_slot_at takes the lock of the profile
 * (lock_profile_bookings): of two bookings on the same slot — or on two slots that only the buffer separates, which
 * the exclusion constraint alone would let through — one succeeds and the other gets CN001 (slot_taken). The cap
 * triggers of the availabilities take the same lock: two concurrent insertions beyond the cap → only one passes.
 */
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import type { BookingSubmission } from "@/domain/booking/booking";
import { err, ok, type Result } from "@/domain/shared/result";
import { makeSupabasePublicBookingReader } from "@/server/booking/repositories/supabase-public-booking-reader";
import { makeSupabaseSlotBooker } from "@/server/booking/repositories/supabase-slot-booker";
import { makeBookSlot } from "@/server/booking/use-cases/book-slot";
import { makeGetPublicBookingPage } from "@/server/booking/use-cases/get-public-booking-page";
import { makeListPublicSlots } from "@/server/booking/use-cases/list-public-slots";
import { makeSupabaseRateLimiter } from "@/server/repositories/supabase-rate-limiter";

import { DESKTOP_USER_AGENT, IPHONE_USER_AGENT } from "../builders/analytics";
import { CHALLENGE_TOKEN } from "../builders/booking";
import { fakeBotChallengeVerifier } from "../builders/fake-bot-challenge-verifier";
import { eventsOf, publishProfile } from "./setup/analytics";
import { insertUpcomingExceptions, minutesAfter } from "./setup/booking-settings";
import { deleteUsersByEmail } from "./setup/cleanup";
import { adminClient, anonClient } from "./setup/clients";
import { RUN_SECRET, UUID_PATTERN, uniqueAddress } from "./setup/fixtures";
import { outboxOf } from "./setup/leads";
import { createMember, type Member } from "./setup/members";
import {
  addMinutes,
  ALL_DAY_RULES,
  anotherSession,
  bookingsOf,
  countRows,
  distinctRules,
  insertEventTypes,
  insertRules,
  instantText,
  ruleAt,
  wholeHourAfter,
  type TypeFixture,
} from "./setup/public-booking";

const CN004 = "CN004";
const WEEK_MINUTES = 168 * 60;

describe("public booking against the local Supabase stack (0039)", () => {
  const admin = adminClient();
  const emails: string[] = [];

  function track(email: string): string {
    emails.push(email);
    return email;
  }

  const pages = makeSupabasePublicBookingReader(anonClient());
  const slotBooker = makeSupabaseSlotBooker(admin);

  function bookSlot(outcome: "passed" | "failed" = "passed") {
    return makeBookSlot({
      rateLimiter: makeSupabaseRateLimiter(admin, RUN_SECRET),
      challenge: fakeBotChallengeVerifier({ outcome }),
      bookings: slotBooker,
    });
  }

  function listPublicSlots() {
    return makeListPublicSlots({
      rateLimiter: makeSupabaseRateLimiter(admin, RUN_SECRET),
      pages,
      clock: { now: () => new Date() },
    });
  }

  /** A published member whose profile takes bookings every day, all day (Europe/Paris), with the given types. */
  async function bookableMember(types: readonly TypeFixture[] = [{}]): Promise<{ member: Member; typeIds: string[] }> {
    const member = await createMember(admin, track);
    await publishProfile(admin, member.profileId);
    const typeIds = await insertEventTypes(admin, member.profileId, types);
    await insertRules(admin, member.profileId, ALL_DAY_RULES);
    return { member, typeIds };
  }

  function submission(typeId: string, start: Date, overrides: Partial<BookingSubmission> = {}): BookingSubmission {
    return {
      eventTypeId: typeId,
      start: instantText(start),
      name: "Jean Visiteur",
      email: "jean.visiteur@example.test",
      phone: null,
      message: null,
      idempotencyKey: randomUUID(),
      ...overrides,
    };
  }

  /** A visitor of its own (fresh address: own 5/h counter), with the token of the widget. */
  function visitor(member: Member, typeId: string, start: Date, overrides: Partial<BookingSubmission> = {}) {
    return {
      ...submission(typeId, start, overrides),
      slug: member.slug,
      challengeToken: CHALLENGE_TOKEN,
      userAgent: IPHONE_USER_AGENT,
      clientAddress: uniqueAddress(),
    };
  }

  function sortedOutcomes(results: readonly Result<unknown, string>[]): string[] {
    return results.map((result) => (result.ok ? "ok" : result.error)).sort();
  }

  afterEach(async () => {
    const { survivingProfileIds } = await deleteUsersByEmail(admin, emails.splice(0));

    expect(survivingProfileIds).toStrictEqual([]);
  });

  describe("public reads (get_public_booking_page, get_public_busy_ranges)", () => {
    it("the page as the anonymous client reads it: active types by position, rules HH:MM, address of in_person only", async () => {
      const member = await createMember(admin, track);
      await publishProfile(admin, member.profileId);
      const [video, , visit] = await insertEventTypes(admin, member.profileId, [
        { title: "Appel découverte", location_kind: "video", location_text: "https://visio.example.test/secret" },
        { title: "Ancien type", is_active: false },
        { title: "Visite", location_kind: "in_person", location_text: "12 rue des Lilas, 69003 Lyon", duration_min: 60, buffer_min: 15 },
      ]);
      await insertRules(admin, member.profileId, [
        { weekday: 1, start_time: "09:00", end_time: "12:30" },
        { weekday: 7, start_time: "20:00", end_time: "24:00" },
      ]);

      const result = await makeGetPublicBookingPage({ pages })(member.slug);

      expect(result.ok).toBe(true);
      const page = result.ok ? result.value : null;
      expect(page?.timeZone).toBe("Europe/Paris");
      expect(page?.eventTypes.map((type) => [type.id, type.title, type.locationKind, type.locationText])).toStrictEqual([
        [video, "Appel découverte", "video", null],
        [visit, "Visite", "in_person", "12 rue des Lilas, 69003 Lyon"],
      ]);
      expect(page?.rules).toStrictEqual([
        { weekday: 1, start: "09:00", end: "12:30" },
        { weekday: 7, start: "20:00", end: "24:00" },
      ]);
      expect(JSON.stringify(page)).not.toContain("visio.example.test/secret");
    });

    it("criterion 3: unpublished profile, or published without any active type → not_found", async () => {
      const unpublished = await createMember(admin, track);
      await insertEventTypes(admin, unpublished.profileId, [{}]);
      const inactiveOnly = await createMember(admin, track);
      await publishProfile(admin, inactiveOnly.profileId);
      await insertEventTypes(admin, inactiveOnly.profileId, [{ is_active: false }]);

      const getPublicBookingPage = makeGetPublicBookingPage({ pages });

      expect(await getPublicBookingPage(unpublished.slug)).toStrictEqual(err("not_found"));
      expect(await getPublicBookingPage(inactiveOnly.slug)).toStrictEqual(err("not_found"));
    });

    it("decision 2: the week of slots is read without 22023 and a booked slot disappears from it", async () => {
      const { member, typeIds } = await bookableMember([{ duration_min: 30, buffer_min: 30 }]);
      const [typeId = ""] = typeIds;
      const start = wholeHourAfter(new Date(), 26);
      const now = new Date();
      const input = {
        slug: member.slug,
        eventTypeId: typeId,
        from: instantText(now),
        to: instantText(addMinutes(now, WEEK_MINUTES)),
        clientAddress: uniqueAddress(),
      };

      const before = await listPublicSlots()(input);
      expect(before.ok).toBe(true);
      const offered = before.ok ? before.value.map((slot) => slot.start.toString()) : [];
      expect(offered).toContain(instantText(start));
      expect(offered).toContain(instantText(addMinutes(start, 60)));

      expect(await bookSlot()(visitor(member, typeId, start))).toMatchObject({ ok: true });

      const after = await listPublicSlots()(input);
      const remaining = after.ok ? after.value.map((slot) => slot.start.toString()) : [];
      expect(remaining).not.toContain(instantText(start));
      expect(remaining).not.toContain(instantText(addMinutes(start, 30)));
      expect(remaining).not.toContain(instantText(addMinutes(start, -30)));
      expect(remaining).toContain(instantText(addMinutes(start, 60)));
    });

    it("note reported from 0037: a week ending near the 60-day horizon is still read (occupations up to to + 720 min)", async () => {
      const { member, typeIds } = await bookableMember();
      const fromDate = addMinutes(new Date(), 1440 * 60 - 24 * 60);
      const from = instantText(fromDate);
      const to = instantText(addMinutes(fromDate, WEEK_MINUTES));

      const result = await listPublicSlots()({ slug: member.slug, eventTypeId: typeIds[0] ?? "", from, to, clientAddress: uniqueAddress() });

      expect(result.ok).toBe(true);
    });

    it("criterion 3: unpublished profile → the slots are not_found", async () => {
      const member = await createMember(admin, track);
      const [typeId = ""] = await insertEventTypes(admin, member.profileId, [{}]);
      await insertRules(admin, member.profileId, ALL_DAY_RULES);

      const now = new Date();
      const result = await listPublicSlots()({
        slug: member.slug,
        eventTypeId: typeId,
        from: instantText(now),
        to: instantText(addMinutes(now, WEEK_MINUTES)),
        clientAddress: uniqueAddress(),
      });

      expect(result).toStrictEqual(err("not_found"));
    });
  });

  describe("criterion 1: booking through book_slot", () => {
    it("a valid booking: the row, one booking.confirmed outbox event, one booking_confirmed with the visitor's device", async () => {
      const { member, typeIds } = await bookableMember();
      const [typeId = ""] = typeIds;
      const start = wholeHourAfter(new Date(), 30);
      const input = { ...visitor(member, typeId, start, { message: "Ligne 1\nLigne 2" }), userAgent: DESKTOP_USER_AGENT };

      const result = await bookSlot()(input);

      expect(result.ok).toBe(true);
      const bookingId = result.ok ? result.value.bookingId : "";
      expect(bookingId).toMatch(UUID_PATTERN);
      const bookings = await bookingsOf(admin, member.profileId);
      expect(bookings).toHaveLength(1);
      expect(bookings[0]).toMatchObject({
        id: bookingId,
        event_type_id: typeId,
        status: "confirmed",
        visitor_name: "Jean Visiteur",
        visitor_email: "jean.visiteur@example.test",
        visitor_phone: null,
        message: "Ligne 1\nLigne 2",
        idempotency_key: input.idempotencyKey,
      });
      const outbox = (await outboxOf(admin, member.profileId)).filter((event) => event.type === "booking.confirmed");
      expect(outbox).toHaveLength(1);
      const confirmed = (await eventsOf(admin, member.profileId)).filter((event) => event.type === "booking_confirmed");
      expect(confirmed.map((event) => [event.id, event.device_class])).toStrictEqual([[bookingId, "desktop"]]);
    });

    it("criterion 1 / idempotence: double submission (same key, new token) → one booking, one outbox event, one statistic", async () => {
      const { member, typeIds } = await bookableMember();
      const input = visitor(member, typeIds[0] ?? "", wholeHourAfter(new Date(), 30));

      const first = await bookSlot()(input);
      const second = await bookSlot()({ ...input, clientAddress: uniqueAddress() });

      expect(first.ok).toBe(true);
      expect(second).toStrictEqual(first);
      expect(await bookingsOf(admin, member.profileId)).toHaveLength(1);
      expect((await outboxOf(admin, member.profileId)).filter((event) => event.type === "booking.confirmed")).toHaveLength(1);
      expect((await eventsOf(admin, member.profileId)).filter((event) => event.type === "booking_confirmed")).toHaveLength(1);
    });

    it("decision 3: phone type — refused without phone (phone_required, nothing written), booked with one", async () => {
      const { member, typeIds } = await bookableMember([{ location_kind: "phone" }]);
      const [typeId = ""] = typeIds;
      const start = wholeHourAfter(new Date(), 30);

      expect(await bookSlot()(visitor(member, typeId, start))).toStrictEqual(err("phone_required"));
      expect(await bookingsOf(admin, member.profileId)).toStrictEqual([]);

      expect(await bookSlot()(visitor(member, typeId, start, { phone: "+33 6 12 34 56 78" }))).toMatchObject({ ok: true });
      expect((await bookingsOf(admin, member.profileId)).map((booking) => booking.visitor_phone)).toStrictEqual(["+33 6 12 34 56 78"]);
    });
  });

  describe("criterion 2: refusals, nothing written", () => {
    it("slot already taken by another visitor (CN001) → slot_taken", async () => {
      const { member, typeIds } = await bookableMember();
      const start = wholeHourAfter(new Date(), 30);
      await bookSlot()(visitor(member, typeIds[0] ?? "", start));

      expect(await bookSlot()(visitor(member, typeIds[0] ?? "", start))).toStrictEqual(err("slot_taken"));
      expect(await bookingsOf(admin, member.profileId)).toHaveLength(1);
    });

    it("start not aligned on the step (CN002) → slot_unavailable", async () => {
      const { member, typeIds } = await bookableMember();

      const result = await bookSlot()(visitor(member, typeIds[0] ?? "", addMinutes(wholeHourAfter(new Date(), 30), 10)));

      expect(result).toStrictEqual(err("slot_unavailable"));
      expect(await bookingsOf(admin, member.profileId)).toStrictEqual([]);
    });

    it("note inherited from 0036: a visitor field refused by a constraint (23514) → invalid_input", async () => {
      const { member, typeIds } = await bookableMember();

      const result = await bookSlot()(visitor(member, typeIds[0] ?? "", wholeHourAfter(new Date(), 30), { name: "n".repeat(101) }));

      expect(result).toStrictEqual(err("invalid_input"));
      expect(await bookingsOf(admin, member.profileId)).toStrictEqual([]);
    });

    it("criterion 3: unpublished profile, inactive type → not_found", async () => {
      const unpublished = await createMember(admin, track);
      const [typeId = ""] = await insertEventTypes(admin, unpublished.profileId, [{}]);
      await insertRules(admin, unpublished.profileId, ALL_DAY_RULES);
      const { member, typeIds } = await bookableMember([{}, { is_active: false }]);
      const start = wholeHourAfter(new Date(), 30);

      expect(await bookSlot()(visitor(unpublished, typeId, start))).toStrictEqual(err("not_found"));
      expect(await bookSlot()(visitor(member, typeIds[1] ?? "", start))).toStrictEqual(err("not_found"));
      expect(await bookingsOf(admin, unpublished.profileId)).toStrictEqual([]);
      expect(await bookingsOf(admin, member.profileId)).toStrictEqual([]);
    });

    it("Turnstile refused → challenge_failed, nothing written", async () => {
      const { member, typeIds } = await bookableMember();

      expect(await bookSlot("failed")(visitor(member, typeIds[0] ?? "", wholeHourAfter(new Date(), 30)))).toStrictEqual(err("challenge_failed"));
      expect(await bookingsOf(admin, member.profileId)).toStrictEqual([]);
    });

    it("limit booking:<address> 5/h: the sixth attempt from one address → rate_limited, nothing written", async () => {
      const { member, typeIds } = await bookableMember();
      const address = uniqueAddress();
      const input = { ...visitor(member, typeIds[0] ?? "", wholeHourAfter(new Date(), 30)), clientAddress: address };

      const attempts = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        attempts.push(await bookSlot("failed")({ ...input, idempotencyKey: randomUUID() }));
      }

      expect(attempts.map((result) => (result.ok ? "ok" : result.error))).toStrictEqual([
        ...Array<string>(5).fill("challenge_failed"),
        "rate_limited",
      ]);
      expect(await bookingsOf(admin, member.profileId)).toStrictEqual([]);
    });
  });

  describe("real concurrency (two transactions)", () => {
    it("criterion 1: the same slot booked twice at once, five times → each time one booking and one slot_taken", async () => {
      const { member, typeIds } = await bookableMember();
      const [typeId = ""] = typeIds;
      const base = wholeHourAfter(new Date(), 30);

      for (let round = 0; round < 5; round += 1) {
        const start = addMinutes(base, round * 120);
        const command = (key: string) => ({ ...submission(typeId, start, { idempotencyKey: key }), slug: member.slug, deviceClass: "mobile" as const });

        const results = await Promise.all([slotBooker.book(command(randomUUID())), slotBooker.book(command(randomUUID()))]);

        expect(sortedOutcomes(results), `round ${round}`).toStrictEqual(["ok", "slot_taken"]);
      }
      expect(await bookingsOf(admin, member.profileId)).toHaveLength(5);
    });

    it("criterion 1: two adjacent slots that only the buffer separates, booked at once → one booking and one slot_taken", async () => {
      const { member, typeIds } = await bookableMember([{ duration_min: 30, buffer_min: 30 }]);
      const [typeId = ""] = typeIds;
      const base = wholeHourAfter(new Date(), 30);

      for (let round = 0; round < 5; round += 1) {
        const start = addMinutes(base, round * 180);
        const command = (at: Date) => ({ ...submission(typeId, at), slug: member.slug, deviceClass: "mobile" as const });

        const results = await Promise.all([slotBooker.book(command(start)), slotBooker.book(command(addMinutes(start, 30)))]);

        expect(sortedOutcomes(results), `round ${round}`).toStrictEqual(["ok", "slot_taken"]);
      }
      expect(await bookingsOf(admin, member.profileId)).toHaveLength(5);
    });

    it("point 8: two bookings at once on a profile with 19 bookings in 23 h → one ok, one profile_quota (CN005 under the lock)", async () => {
      const { member, typeIds } = await bookableMember();
      const [typeId = ""] = typeIds;
      const base = wholeHourAfter(new Date(), 30);
      const command = (at: Date) => ({ ...submission(typeId, at), slug: member.slug, deviceClass: "mobile" as const });
      for (let index = 0; index < 19; index += 1) {
        expect(await slotBooker.book(command(addMinutes(base, index * 60))), `booking ${index}`).toMatchObject({ ok: true });
      }

      const results = await Promise.all([slotBooker.book(command(addMinutes(base, 19 * 60))), slotBooker.book(command(addMinutes(base, 20 * 60)))]);

      expect(sortedOutcomes(results)).toStrictEqual(["ok", "profile_quota"]);
      expect(await bookingsOf(admin, member.profileId)).toHaveLength(20);
      expect(await bookSlot()(visitor(member, typeId, addMinutes(base, 21 * 60)))).toStrictEqual(err("rate_limited"));
      expect(await bookingsOf(admin, member.profileId)).toHaveLength(20);
    });

    it("the same key sent twice at once → one booking, both answers carry its id", async () => {
      const { member, typeIds } = await bookableMember();
      const command = { ...submission(typeIds[0] ?? "", wholeHourAfter(new Date(), 30)), slug: member.slug, deviceClass: "mobile" as const };

      const [first, second] = await Promise.all([slotBooker.book(command), slotBooker.book(command)]);

      expect(first).toMatchObject({ ok: true });
      expect(second).toStrictEqual(first);
      expect(await bookingsOf(admin, member.profileId)).toHaveLength(1);
    });

    it("audit 0036: two concurrent insertions of rules beyond the cap of 50 → only one passes (CN004 for the other)", async () => {
      const member = await createMember(admin, track);
      const second = await anotherSession(member.email);

      for (let round = 0; round < 3; round += 1) {
        await admin.from("availability_rules").delete().eq("profile_id", member.profileId);
        await insertRules(admin, member.profileId, distinctRules(49));
        const a = ruleAt(49 + round * 2);
        const b = ruleAt(50 + round * 2);

        const results = await Promise.all([
          member.session.from("availability_rules").insert({ profile_id: member.profileId, ...a }),
          second.from("availability_rules").insert({ profile_id: member.profileId, ...b }),
        ]);

        expect(results.map((result) => result.error?.code ?? "ok").sort(), `round ${round}`).toStrictEqual([CN004, "ok"]);
        expect(await countRows(admin, "availability_rules", member.profileId)).toBe(50);
      }
    });

    it("audit 0036: two concurrent insertions of exceptions beyond the cap of 200 → only one passes (CN004 for the other)", async () => {
      const member = await createMember(admin, track);
      const second = await anotherSession(member.email);
      const firstStart = minutesAfter(new Date(), 24 * 60);
      await insertUpcomingExceptions(admin, member.profileId, firstStart, 199);
      const range = (hours: number) => {
        const start = minutesAfter(firstStart, hours * 60);
        return `[${start.toISOString()},${addMinutes(start, 30).toISOString()})`;
      };

      const results = await Promise.all([
        member.session.from("availability_exceptions").insert({ profile_id: member.profileId, kind: "busy", range: range(300) }),
        second.from("availability_exceptions").insert({ profile_id: member.profileId, kind: "busy", range: range(301) }),
      ]);

      expect(results.map((result) => result.error?.code ?? "ok").sort()).toStrictEqual([CN004, "ok"]);
      expect(await countRows(admin, "availability_exceptions", member.profileId)).toBe(200);
    });
  });

  it("reads are anonymous: the reader never needs the service_role client", async () => {
    const { member } = await bookableMember();

    expect(await makeSupabasePublicBookingReader(anonClient()).page(member.slug)).toMatchObject(ok({ timeZone: "Europe/Paris" }));
  });
});
