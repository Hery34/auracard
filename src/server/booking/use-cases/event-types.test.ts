/**
 * Contract frozen by test-engineer (0038, decisions 1 and 3; notes of 0036; ADR 0012).
 *
 * // src/domain/booking/ports.ts — under the session client (RLS), never service_role.
 * export type NewEventType = EventTypeDraft & { id: string; position: number };
 * export type EventTypeWriteError = "not_found" | "conflict" | "invalid_input" | "unexpected";
 * export interface EventTypeRepository {
 *   // Types of the profile by position (at most 10: direct read). Another account's profile → [].
 *   listOwn(profileId: string): Promise<Result<EventType[], "unexpected">>;
 *   // Insert with the client-generated id (the idempotency key) and the given position; returns the stored row (active).
 *   // 23505 (id or position already taken) → conflict; 42501 (RLS) → not_found; 23514 → invalid_input.
 *   create(profileId: string, eventType: NewEventType): Promise<Result<EventType, EventTypeWriteError>>;
 *   // Full update of the business fields (column grants of 0036); no row → not_found; 23514 → invalid_input.
 *   update(profileId: string, id: string, draft: EventTypeDraft): Promise<Result<EventType, "not_found" | "invalid_input" | "unexpected">>;
 *   setActive(profileId: string, id: string, isActive: boolean): Promise<Result<EventType, "not_found" | "unexpected">>;
 *   // carnet.reorder_event_types(p_profile_id, p_ids) — positions 0…n−1 in the given order, in one statement
 *   // (event_types_profile_id_position_key deferrable); 22023 → invalid_input; 42501 → not_found. Returns the types by position.
 *   reorder(profileId: string, ids: readonly string[]): Promise<Result<EventType[], "not_found" | "invalid_input" | "unexpected">>;
 *   // Absent or someone else's: success, nothing done (no oracle). 23503 (bookings_event_type_id_profile_id_fkey,
 *   // on delete no action) → has_bookings.
 *   remove(profileId: string, id: string): Promise<Result<void, "has_bookings" | "unexpected">>;
 * }
 *
 * // src/server/booking/use-cases/*.ts — every write: authorizeProfileWrite (session → profile-write → own profile),
 * // then the repository with the profile id read by getOwn, never an id sent by the client.
 * // create-event-type.ts
 * export type CreateEventTypeError = "unauthenticated" | "not_found" | "rate_limited" | "limit_reached" | "conflict" | "invalid_input" | "unexpected";
 * export type CreateEventType = (command: EventTypeDraft & { id: string }) => Promise<Result<EventType, CreateEventTypeError>>;
 * export function makeCreateEventType(deps: { auth; rateLimiter; profiles; eventTypes: EventTypeRepository }): CreateEventType;
 * //   listOwn → the id already exists → ok(existing) without writing (replay) → firstFreePosition → null: limit_reached
 * //   → create → conflict: listOwn once more, the id now exists → ok(it), else err("conflict").
 * // update-event-type.ts
 * export type UpdateEventTypeError = "unauthenticated" | "not_found" | "rate_limited" | "invalid_input" | "unexpected";
 * export type UpdateEventType = (command: EventTypeDraft & { id: string }) => Promise<Result<EventType, UpdateEventTypeError>>;
 * // set-event-type-active.ts
 * export type SetEventTypeActiveError = "unauthenticated" | "not_found" | "rate_limited" | "unexpected";
 * export type SetEventTypeActive = (command: { id: string; isActive: boolean }) => Promise<Result<EventType, SetEventTypeActiveError>>;
 * // reorder-event-types.ts — listOwn → not a permutation of the current ids → conflict (stale list) → reorder.
 * export type ReorderEventTypesError = "unauthenticated" | "not_found" | "rate_limited" | "conflict" | "invalid_input" | "unexpected";
 * export type ReorderEventTypes = (ids: readonly string[]) => Promise<Result<EventType[], ReorderEventTypesError>>;
 * // delete-event-type.ts
 * export type DeleteEventTypeError = "unauthenticated" | "not_found" | "rate_limited" | "has_bookings" | "unexpected";
 * export type DeleteEventType = (id: string) => Promise<Result<void, DeleteEventTypeError>>;
 */
import { describe, expect, it } from "vitest";

import type { EventType } from "@/domain/booking/event-type";
import { err, ok } from "@/domain/shared/result";
import { makeCreateEventType } from "@/server/booking/use-cases/create-event-type";
import { makeDeleteEventType } from "@/server/booking/use-cases/delete-event-type";
import { makeReorderEventTypes } from "@/server/booking/use-cases/reorder-event-types";
import { makeSetEventTypeActive } from "@/server/booking/use-cases/set-event-type-active";
import { makeUpdateEventType } from "@/server/booking/use-cases/update-event-type";

import { EVENT_TYPE_IDS, anEventType, anEventTypeDraft } from "../../../../tests/builders/booking-settings";
import { makeCallLog } from "../../../../tests/builders/call-log";
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
import { fakeRateLimiter, type FakeRateLimiterOptions } from "../../../../tests/builders/fake-rate-limiter";
import { PROFILE_ID } from "../../../../tests/builders/fake-registrar";

const AUTHENTICATED = ok({ userId: GATEWAY_USER_ID, email: GATEWAY_USER_EMAIL });
const PROFILE_WRITE_CONSUME = { scope: "profile-write", subject: GATEWAY_USER_ID, limit: 60, windowSeconds: 3600 };
const AUTHORIZATION = ["auth.currentUser", "rateLimiter.consume", "profiles.getOwn"];

type Overrides = {
  auth?: FakeAuthGatewayOptions;
  limiter?: FakeRateLimiterOptions;
  profiles?: FakeProfileReaderOptions;
  eventTypes?: FakeEventTypeRepositoryOptions;
};

function harness(overrides: Overrides = {}) {
  const log = makeCallLog();
  const deps = {
    auth: fakeAuthGateway({ log, currentUser: AUTHENTICATED, ...overrides.auth }),
    rateLimiter: fakeRateLimiter({ log, ...overrides.limiter }),
    profiles: fakeProfileReader({ log, ...overrides.profiles }),
    eventTypes: fakeEventTypeRepository({ log, ...overrides.eventTypes }),
  };
  return {
    log,
    createEventType: makeCreateEventType(deps),
    updateEventType: makeUpdateEventType(deps),
    setEventTypeActive: makeSetEventTypeActive(deps),
    reorderEventTypes: makeReorderEventTypes(deps),
    deleteEventType: makeDeleteEventType(deps),
  };
}

type Harness = ReturnType<typeof harness>;

/** One call of each write use case, with valid input. */
const WRITES: ReadonlyArray<readonly [string, (h: Harness) => Promise<unknown>]> = [
  ["createEventType", (h) => h.createEventType({ id: EVENT_TYPE_IDS[0], ...anEventTypeDraft() })],
  ["updateEventType", (h) => h.updateEventType({ id: EVENT_TYPE_IDS[0], ...anEventTypeDraft() })],
  ["setEventTypeActive", (h) => h.setEventTypeActive({ id: EVENT_TYPE_IDS[0], isActive: false })],
  ["reorderEventTypes", (h) => h.reorderEventTypes([EVENT_TYPE_IDS[0]])],
  ["deleteEventType", (h) => h.deleteEventType(EVENT_TYPE_IDS[0])],
];

function typesAt(positions: readonly number[]): EventType[] {
  return positions.map((position, index) =>
    anEventType({ id: `00000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`, position }),
  );
}

describe("authorization in every event type use case (decision 1, criterion 2)", () => {
  it.each(WRITES)("%s: no session → err('unauthenticated'), nothing consumed, read nor written", async (_name, call) => {
    const h = harness({ auth: { currentUser: ok(null) } });

    expect(await call(h)).toStrictEqual(err("unauthenticated"));
    expect(h.log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it.each(WRITES)("%s: GoTrue unreachable → err('unexpected'), nothing written", async (_name, call) => {
    const h = harness({ auth: { currentUser: err("unexpected") } });

    expect(await call(h)).toStrictEqual(err("unexpected"));
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
    expect(h.log.sequence()).toStrictEqual(["auth.currentUser", "rateLimiter.consume"]);
  });

  it.each(WRITES)("%s: an account without carnet profile (another project) → err('not_found'), nothing touched", async (_name, call) => {
    const h = harness({ profiles: { results: [ok(null)] } });

    expect(await call(h)).toStrictEqual(err("not_found"));
    expect(h.log.sequence()).toStrictEqual(AUTHORIZATION);
  });

  it.each(WRITES)("%s: the repository always receives the profile id read by getOwn", async (_name, call) => {
    const h = harness({ eventTypes: { list: [ok([anEventType()])] } });

    await call(h);

    const repositoryCalls = h.log.entries.filter((entry) => entry.port === "eventTypes");
    expect(repositoryCalls.length).toBeGreaterThan(0);
    for (const entry of repositoryCalls) {
      expect((entry.input as { profileId: string }).profileId).toBe(PROFILE_ID);
    }
  });
});

describe("createEventType — criterion 1, decision 3 (at most 10 types, free position)", () => {
  it("no type yet → created at position 0 with the client id; returns the stored type", async () => {
    const h = harness();
    const command = { id: EVENT_TYPE_IDS[1], ...anEventTypeDraft() };

    expect(await h.createEventType(command)).toStrictEqual(
      ok(anEventType({ id: EVENT_TYPE_IDS[1], position: 0, isActive: true })),
    );
    expect(h.log.sequence()).toStrictEqual([...AUTHORIZATION, "eventTypes.listOwn", "eventTypes.create"]);
    expect(h.log.inputsOf("eventTypes", "create")).toStrictEqual([
      { profileId: PROFILE_ID, eventType: { ...anEventTypeDraft(), id: EVENT_TYPE_IDS[1], position: 0 } },
    ]);
  });

  it("note of 0036: takes the lowest free position (gap left by a deletion)", async () => {
    const h = harness({ eventTypes: { list: [ok(typesAt([0, 1, 3, 4]))] } });

    await h.createEventType({ id: EVENT_TYPE_IDS[1], ...anEventTypeDraft() });

    expect(h.log.inputsOf("eventTypes", "create")).toStrictEqual([
      { profileId: PROFILE_ID, eventType: { ...anEventTypeDraft(), id: EVENT_TYPE_IDS[1], position: 2 } },
    ]);
  });

  it("decision 3: ten types already → err('limit_reached'), nothing written", async () => {
    const h = harness({ eventTypes: { list: [ok(typesAt([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))] } });

    expect(await h.createEventType({ id: EVENT_TYPE_IDS[1], ...anEventTypeDraft() })).toStrictEqual(err("limit_reached"));
    expect(h.log.inputsOf("eventTypes", "create")).toStrictEqual([]);
  });

  it("idempotence: the id already exists among the caller's types → ok(that type), nothing written (double click)", async () => {
    const existing = anEventType({ id: EVENT_TYPE_IDS[1], position: 4, title: "Déjà créé" });
    const h = harness({ eventTypes: { list: [ok([anEventType(), existing])] } });

    expect(await h.createEventType({ id: EVENT_TYPE_IDS[1], ...anEventTypeDraft() })).toStrictEqual(ok(existing));
    expect(h.log.inputsOf("eventTypes", "create")).toStrictEqual([]);
  });

  it("idempotence, executed twice: the second call returns the first result and writes nothing more", async () => {
    const command = { id: EVENT_TYPE_IDS[1], ...anEventTypeDraft() };
    const stored = anEventType({ id: EVENT_TYPE_IDS[1], position: 0 });
    const h = harness({ eventTypes: { list: [ok([]), ok([stored])], create: [ok(stored)] } });

    const first = await h.createEventType(command);
    const second = await h.createEventType(command);

    expect(first).toStrictEqual(ok(stored));
    expect(second).toStrictEqual(first);
    expect(h.log.inputsOf("eventTypes", "create")).toHaveLength(1);
  });

  it("concurrent replay: create answers conflict and the id now exists → ok(it)", async () => {
    const stored = anEventType({ id: EVENT_TYPE_IDS[1], position: 0 });
    const h = harness({ eventTypes: { list: [ok([]), ok([stored])], create: [err("conflict")] } });

    expect(await h.createEventType({ id: EVENT_TYPE_IDS[1], ...anEventTypeDraft() })).toStrictEqual(ok(stored));
    expect(h.log.sequence()).toStrictEqual([
      ...AUTHORIZATION,
      "eventTypes.listOwn",
      "eventTypes.create",
      "eventTypes.listOwn",
    ]);
  });

  it("concurrent creation of another type on the same position → err('conflict') (no blind retry)", async () => {
    const h = harness({ eventTypes: { list: [ok([]), ok(typesAt([0]))], create: [err("conflict")] } });

    expect(await h.createEventType({ id: EVENT_TYPE_IDS[1], ...anEventTypeDraft() })).toStrictEqual(err("conflict"));
    expect(h.log.inputsOf("eventTypes", "create")).toHaveLength(1);
  });

  it.each(["not_found", "invalid_input", "unexpected"] as const)("create answers %s → err(%j)", async (error) => {
    const h = harness({ eventTypes: { create: [err(error)] } });

    expect(await h.createEventType({ id: EVENT_TYPE_IDS[1], ...anEventTypeDraft() })).toStrictEqual(err(error));
  });

  it("listOwn fails → err('unexpected'), nothing written", async () => {
    const h = harness({ eventTypes: { list: [err("unexpected")] } });

    expect(await h.createEventType({ id: EVENT_TYPE_IDS[1], ...anEventTypeDraft() })).toStrictEqual(err("unexpected"));
    expect(h.log.inputsOf("eventTypes", "create")).toStrictEqual([]);
  });
});

describe("updateEventType — criterion 1 (modification)", () => {
  it("forwards the full draft for the given id → ok(stored type)", async () => {
    const draft = anEventTypeDraft({ title: "Atelier", durationMin: 90, locationKind: "in_person", locationText: "12 rue des Lilas" });
    const stored = anEventType({ ...draft, position: 2 });
    const h = harness({ eventTypes: { update: [ok(stored)] } });

    expect(await h.updateEventType({ id: EVENT_TYPE_IDS[0], ...draft })).toStrictEqual(ok(stored));
    expect(h.log.sequence()).toStrictEqual([...AUTHORIZATION, "eventTypes.update"]);
    expect(h.log.inputsOf("eventTypes", "update")).toStrictEqual([{ profileId: PROFILE_ID, id: EVENT_TYPE_IDS[0], draft }]);
  });

  it("criterion 2: another account's type (no row under RLS) → err('not_found')", async () => {
    const h = harness({ eventTypes: { update: [err("not_found")] } });

    expect(await h.updateEventType({ id: EVENT_TYPE_IDS[3], ...anEventTypeDraft() })).toStrictEqual(err("not_found"));
  });

  it("replayed: the same update twice gives the same result (full update, never relative)", async () => {
    const h = harness({ eventTypes: { update: [ok(anEventType())] } });
    const command = { id: EVENT_TYPE_IDS[0], ...anEventTypeDraft() };

    const first = await h.updateEventType(command);
    const second = await h.updateEventType(command);

    expect(second).toStrictEqual(first);
    expect(h.log.inputsOf("eventTypes", "update")).toStrictEqual([
      { profileId: PROFILE_ID, id: EVENT_TYPE_IDS[0], draft: anEventTypeDraft() },
      { profileId: PROFILE_ID, id: EVENT_TYPE_IDS[0], draft: anEventTypeDraft() },
    ]);
  });

  it.each(["invalid_input", "unexpected"] as const)("update answers %s → err(%j)", async (error) => {
    const h = harness({ eventTypes: { update: [err(error)] } });

    expect(await h.updateEventType({ id: EVENT_TYPE_IDS[0], ...anEventTypeDraft() })).toStrictEqual(err(error));
  });
});

describe("setEventTypeActive — decision 3 (a deactivated type leaves the public page, its bookings stay)", () => {
  it("deactivates → ok(type with isActive false)", async () => {
    const stored = anEventType({ isActive: false });
    const h = harness({ eventTypes: { setActive: [ok(stored)] } });

    expect(await h.setEventTypeActive({ id: EVENT_TYPE_IDS[0], isActive: false })).toStrictEqual(ok(stored));
    expect(h.log.sequence()).toStrictEqual([...AUTHORIZATION, "eventTypes.setActive"]);
    expect(h.log.inputsOf("eventTypes", "setActive")).toStrictEqual([
      { profileId: PROFILE_ID, id: EVENT_TYPE_IDS[0], isActive: false },
    ]);
  });

  it("reactivates, replayable (same call twice, same state)", async () => {
    const h = harness({ eventTypes: { setActive: [ok(anEventType())] } });

    const first = await h.setEventTypeActive({ id: EVENT_TYPE_IDS[0], isActive: true });
    const second = await h.setEventTypeActive({ id: EVENT_TYPE_IDS[0], isActive: true });

    expect(second).toStrictEqual(first);
    expect(first).toStrictEqual(ok(anEventType()));
  });

  it("criterion 2: another account's type → err('not_found')", async () => {
    const h = harness({ eventTypes: { setActive: [err("not_found")] } });

    expect(await h.setEventTypeActive({ id: EVENT_TYPE_IDS[3], isActive: false })).toStrictEqual(err("not_found"));
  });
});

describe("reorderEventTypes — criterion 1 (one statement, note of 0036)", () => {
  const current = [
    anEventType({ id: EVENT_TYPE_IDS[0], position: 0 }),
    anEventType({ id: EVENT_TYPE_IDS[1], position: 1 }),
    anEventType({ id: EVENT_TYPE_IDS[2], position: 3 }),
  ];
  const order = [EVENT_TYPE_IDS[2], EVENT_TYPE_IDS[0], EVENT_TYPE_IDS[1]];
  const reordered = [
    anEventType({ id: EVENT_TYPE_IDS[2], position: 0 }),
    anEventType({ id: EVENT_TYPE_IDS[0], position: 1 }),
    anEventType({ id: EVENT_TYPE_IDS[1], position: 2 }),
  ];

  it("a permutation of the caller's types → one reorder call with the full order → ok(types by position)", async () => {
    const h = harness({ eventTypes: { list: [ok(current)], reorder: [ok(reordered)] } });

    expect(await h.reorderEventTypes(order)).toStrictEqual(ok(reordered));
    expect(h.log.sequence()).toStrictEqual([...AUTHORIZATION, "eventTypes.listOwn", "eventTypes.reorder"]);
    expect(h.log.inputsOf("eventTypes", "reorder")).toStrictEqual([{ profileId: PROFILE_ID, ids: order }]);
  });

  it.each([
    ["a missing type", [EVENT_TYPE_IDS[2], EVENT_TYPE_IDS[0]]],
    ["another account's type", [EVENT_TYPE_IDS[2], EVENT_TYPE_IDS[0], EVENT_TYPE_IDS[3]]],
    ["a duplicated type", [EVENT_TYPE_IDS[2], EVENT_TYPE_IDS[2], EVENT_TYPE_IDS[1]]],
  ])("%s → err('conflict') (stale or forged list), nothing written", async (_label, ids) => {
    const h = harness({ eventTypes: { list: [ok(current)] } });

    expect(await h.reorderEventTypes(ids)).toStrictEqual(err("conflict"));
    expect(h.log.inputsOf("eventTypes", "reorder")).toStrictEqual([]);
  });

  it("replayed: the same order twice gives the same result", async () => {
    const h = harness({ eventTypes: { list: [ok(current), ok(reordered)], reorder: [ok(reordered)] } });

    const first = await h.reorderEventTypes(order);
    const second = await h.reorderEventTypes(order);

    expect(second).toStrictEqual(first);
  });

  it.each(["not_found", "invalid_input", "unexpected"] as const)("reorder answers %s → err(%j)", async (error) => {
    const h = harness({ eventTypes: { list: [ok(current)], reorder: [err(error)] } });

    expect(await h.reorderEventTypes(order)).toStrictEqual(err(error));
  });
});

describe("deleteEventType — note of 0036 (a type with bookings is deactivated, not deleted)", () => {
  it("deletes the caller's type → ok", async () => {
    const h = harness();

    expect(await h.deleteEventType(EVENT_TYPE_IDS[0])).toStrictEqual(ok(undefined));
    expect(h.log.sequence()).toStrictEqual([...AUTHORIZATION, "eventTypes.remove"]);
    expect(h.log.inputsOf("eventTypes", "remove")).toStrictEqual([{ profileId: PROFILE_ID, id: EVENT_TYPE_IDS[0] }]);
  });

  it("the type has bookings (23503) → err('has_bookings'), so the page can propose to deactivate it", async () => {
    const h = harness({ eventTypes: { remove: [err("has_bookings")] } });

    expect(await h.deleteEventType(EVENT_TYPE_IDS[0])).toStrictEqual(err("has_bookings"));
  });

  it("idempotence, executed twice: an already deleted type is a success both times", async () => {
    const h = harness();

    expect(await h.deleteEventType(EVENT_TYPE_IDS[0])).toStrictEqual(ok(undefined));
    expect(await h.deleteEventType(EVENT_TYPE_IDS[0])).toStrictEqual(ok(undefined));
  });

  it("remove fails → err('unexpected')", async () => {
    const h = harness({ eventTypes: { remove: [err("unexpected")] } });

    expect(await h.deleteEventType(EVENT_TYPE_IDS[0])).toStrictEqual(err("unexpected"));
  });
});
