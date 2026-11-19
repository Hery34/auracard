"use client";

import type { PublicEventType } from "@/domain/booking/ports";
import { BookingConfirmationView } from "@/ui/features/booking/booking-confirmation-view";
import { BookingDetailsForm } from "@/ui/features/booking/booking-details-form";
import { eventTypeOptions } from "@/ui/features/booking/event-type-options";
import { BOOKING_CONFIRMED_MESSAGE } from "@/ui/features/booking/public-messages";
import { SlotPicker } from "@/ui/features/booking/slot-picker";
import { TimeZoneNotice } from "@/ui/features/booking/time-zone-notice";
import { useBookingFlow } from "@/ui/features/booking/use-booking-flow";
import { WeekNav } from "@/ui/features/booking/week-nav";
import { RadioCardGroup } from "@/ui/primitives/radio-card-group";

type Props = { slug: string; ownerName: string; ownerTimeZone: string; eventTypes: readonly PublicEventType[]; siteKey: string };

/** Booking page: type, week, day and slot, then the visitor's details; the confirmation replaces them once booked. */
export function BookingFlow({ slug, ownerName, ownerTimeZone, eventTypes, siteKey }: Props) {
  const flow = useBookingFlow({ slug, ownerName, eventTypes });
  const booked = flow.answer.status === "booked";

  return (
    <div className="flex flex-col gap-6">
      <p role="status" className={booked ? "text-lg font-medium" : "sr-only"}>
        {booked ? BOOKING_CONFIRMED_MESSAGE : ""}
      </p>
      {booked ? (
        flow.confirmation !== null && <BookingConfirmationView confirmation={flow.confirmation} />
      ) : (
        <>
          <TimeZoneNotice timeZone={flow.timeZone} ownerTimeZone={ownerTimeZone} ownerName={ownerName} />
          <RadioCardGroup
            legend="Type de rendez-vous"
            name="booking-type"
            options={eventTypeOptions(eventTypes)}
            value={flow.eventTypeId}
            onChange={flow.chooseType}
          />
          {flow.eventTypeId !== null && (
            <WeekNav canGoBack={flow.canGoBack} canGoForward={flow.canGoForward} onChange={flow.changeWeek} />
          )}
          {flow.timeZone !== null && (
            <SlotPicker
              weekSlots={flow.weekSlots}
              days={flow.days}
              day={flow.day}
              slot={flow.slot}
              timeZone={flow.timeZone}
              onDay={flow.chooseDay}
              onSlot={flow.chooseSlot}
            />
          )}
          {flow.formOpen && flow.eventType !== null && (
            <BookingDetailsForm
              slug={slug}
              ownerName={ownerName}
              siteKey={siteKey}
              eventTypeId={flow.eventType.id}
              start={flow.slot?.start ?? ""}
              idempotencyKey={flow.idempotencyKey}
              phoneRequired={flow.eventType.locationKind === "phone"}
              answer={flow.answer}
              submit={flow.submit}
            />
          )}
        </>
      )}
    </div>
  );
}
