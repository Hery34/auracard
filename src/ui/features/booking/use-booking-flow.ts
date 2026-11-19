"use client";

import { useState } from "react";

import type { PublicEventType } from "@/domain/booking/ports";
import { bookSlotAction, type BookSlotState } from "@/server/booking/public-actions";
import { useBookingBeacon } from "@/ui/features/analytics/use-booking-beacon";
import { toBookingConfirmation, type BookingConfirmation } from "@/ui/features/booking/booking-confirmation";
import { idempotencyKeyFor, needsSlotRefresh, type BookingSelection, type IdempotencyBinding } from "@/ui/features/booking/booking-form-view";
import { groupSlotsByDay, type SlotDay } from "@/ui/features/booking/slot-days";
import { LAST_WEEK } from "@/ui/features/booking/slot-week";
import { useBrowserTimeZone } from "@/ui/features/booking/use-browser-time-zone";
import { useWeekSlots } from "@/ui/features/booking/use-week-slots";

const IDLE: BookSlotState = { status: "idle" };
/** No key before the first choice of a slot: the form (and Cloudflare's script) is mounted with the first key. */
const NO_BINDING: IdempotencyBinding = { key: "", selection: null };

type Props = { slug: string; ownerName: string; eventTypes: readonly PublicEventType[] };

/**
 * State of the booking page: type → week → day → slot, then the submission. The idempotency key changes on a
 * transition only (a new choice or a new answer of the action), never on a render (decision 7).
 */
export function useBookingFlow({ slug, ownerName, eventTypes }: Props) {
  const timeZone = useBrowserTimeZone();
  const { markStarted } = useBookingBeacon(slug);
  const [date, setDate] = useState<string | null>(null);
  const [answer, setAnswer] = useState<BookSlotState>(IDLE);
  const [binding, setBinding] = useState<IdempotencyBinding>(NO_BINDING);
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);
  const weekSlots = useWeekSlots(slug);
  const { eventTypeId, week } = weekSlots;

  const eventType = eventTypes.find((type) => type.id === eventTypeId) ?? null;
  const days: SlotDay[] = timeZone === null ? [] : groupSlotsByDay(weekSlots.slots, timeZone);
  const day = days.find((candidate) => candidate.date === date) ?? null;
  const slot = day?.slots.find((choice) => choice.start === binding.selection?.start) ?? null;

  function select(selection: BookingSelection | null, state: BookSlotState = answer) {
    const fresh = crypto.randomUUID();
    setBinding((current) => idempotencyKeyFor(current, selection, state, () => fresh));
  }

  /** A new type or week clears the day and the slot once its list is read. */
  async function showWeek(id: string, nextWeek: number) {
    if (await weekSlots.show(id, Math.min(LAST_WEEK, Math.max(0, nextWeek)))) {
      setDate(null);
      select(null);
    }
  }

  function chooseType(id: string) {
    void showWeek(id, week);
  }

  function changeWeek(delta: -1 | 1) {
    if (eventTypeId !== null) {
      void showWeek(eventTypeId, week + delta);
    }
  }

  function chooseDay(next: string) {
    setDate(next);
    select(null);
  }

  function chooseSlot(start: string) {
    if (eventTypeId === null) {
      return;
    }
    select({ eventTypeId, start });
    markStarted();
  }

  /** Called by the form inside a transition; the answer decides the next key and whether the slots are read again. */
  async function submit(data: FormData): Promise<BookSlotState> {
    const chosen = slot;
    const chosenType = eventType;
    const next = await bookSlotAction(IDLE, data).catch((): BookSlotState => ({ status: "error", error: "unexpected" }));
    setAnswer(next);
    if (next.status === "booked" && chosen !== null && chosenType !== null && timeZone !== null) {
      setConfirmation(toBookingConfirmation({ bookingId: next.bookingId, slot: chosen, eventType: chosenType, ownerName, timeZone }));
    }
    if (needsSlotRefresh(next)) {
      select(null, next);
      if (eventTypeId !== null) {
        void weekSlots.show(eventTypeId, week);
      }
    } else {
      const fresh = crypto.randomUUID();
      setBinding((current) => idempotencyKeyFor(current, current.selection, next, () => fresh));
    }
    return next;
  }

  return {
    timeZone,
    eventType,
    eventTypeId,
    week,
    canGoBack: week > 0 && !weekSlots.loading,
    canGoForward: week < LAST_WEEK && !weekSlots.loading,
    weekSlots,
    days,
    day,
    slot,
    answer,
    idempotencyKey: binding.key,
    formOpen: binding.key !== "",
    confirmation,
    chooseType,
    changeWeek,
    chooseDay,
    chooseSlot,
    submit,
  };
}
