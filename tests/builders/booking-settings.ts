import type { AvailabilityException, AvailabilityRule } from "@/domain/booking/availability";
import type { EventType, EventTypeDraft } from "@/domain/booking/event-type";

/** Wednesday 18 November 2026, 11:00 in Paris (CET): the "now" of the booking settings tests (`fixedClock`). */
export const SETTINGS_NOW = "2026-11-18T10:00:00.000Z";

/** Version 4 UUIDs of event types (client-generated ids: the idempotency key of a creation). */
export const EVENT_TYPE_IDS = [
  "3e1f6a20-7b4c-4d5e-9f60-1a2b3c4d5e01",
  "4f2a7b31-8c5d-4e6f-a071-2b3c4d5e6f02",
  "5a3b8c42-9d6e-4f70-8182-3c4d5e6f7003",
  "6b4c9d53-ae7f-4081-9293-4d5e6f708104",
] as const;

/** Version 4 UUIDs of availability exceptions (client-generated ids: the idempotency key of an addition). */
export const EXCEPTION_IDS = [
  "7c5dae64-bf80-4192-a3a4-5e6f70819205",
  "8d6ebf75-c091-42a3-b4b5-6f708192a306",
] as const;

/** A valid type as the editor sends it once parsed: a 30-minute video call. */
export function anEventTypeDraft(overrides: Partial<EventTypeDraft> = {}): EventTypeDraft {
  return {
    title: "Appel découverte",
    durationMin: 30,
    bufferMin: 10,
    minNoticeMin: 120,
    locationKind: "video",
    locationText: "https://visio.example.test/elodie",
    ...overrides,
  };
}

/** A stored type: id and position assigned, active. */
export function anEventType(overrides: Partial<EventType> = {}): EventType {
  return { ...anEventTypeDraft(), id: EVENT_TYPE_IDS[0], isActive: true, position: 0, ...overrides };
}

/** Monday 09:00–12:00 (local time of the profile's time zone). */
export function aRule(overrides: Partial<AvailabilityRule> = {}): AvailabilityRule {
  return { weekday: 1, start: "09:00", end: "12:00", ...overrides };
}

/** Monday to Friday, 09:00–12:00 and 14:00–18:00: ten rules, ordered by weekday then start. */
export function aWorkingWeek(): AvailabilityRule[] {
  return [1, 2, 3, 4, 5].flatMap((weekday) => [
    aRule({ weekday: weekday as AvailabilityRule["weekday"], start: "09:00", end: "12:00" }),
    aRule({ weekday: weekday as AvailabilityRule["weekday"], start: "14:00", end: "18:00" }),
  ]);
}

/** An absence from 24 December 2026 14:00 to 27 December 00:00 in Europe/Paris (CET, UTC+1). */
export function anException(overrides: Partial<AvailabilityException> = {}): AvailabilityException {
  return {
    id: EXCEPTION_IDS[0],
    kind: "busy",
    startsAt: "2026-12-24T13:00:00.000Z",
    endsAt: "2026-12-26T23:00:00.000Z",
    ...overrides,
  };
}

/** The same absence as the form sends it: `datetime-local` values in the profile's time zone. */
export function anExceptionInput(
  overrides: Partial<{ id: string; kind: string; start: string; end: string }> = {},
): { id: string; kind: string; start: string; end: string } {
  return { id: EXCEPTION_IDS[0], kind: "busy", start: "2026-12-24T14:00", end: "2026-12-27T00:00", ...overrides };
}
