"use client";

import { useTransition, type FormEvent } from "react";

import { BOOKING_CHALLENGE_ACTION, BOOKING_TEXT_MAX_LENGTH } from "@/domain/booking/booking";
import type { BookSlotState } from "@/server/booking/public-actions";
import { needsNewChallenge, toBookingFormView } from "@/ui/features/booking/booking-form-view";
import { BOOKING_SUBMIT_LABEL, bookingConsentLabel, bookingPrivacyNotice } from "@/ui/features/booking/public-messages";
import { useTurnstile } from "@/ui/features/challenge/use-turnstile";
import { Button } from "@/ui/primitives/button";
import { ConsentField } from "@/ui/primitives/consent-field";
import { Field } from "@/ui/primitives/field";
import { TextareaField } from "@/ui/primitives/textarea-field";

type Props = {
  slug: string;
  ownerName: string;
  siteKey: string;
  eventTypeId: string;
  /** Empty while no slot is chosen: the form stays mounted (typed values kept), the button is disabled. */
  start: string;
  idempotencyKey: string;
  phoneRequired: boolean;
  answer: BookSlotState;
  submit: (data: FormData) => Promise<BookSlotState>;
};

/**
 * Visitor's details, mounted with the first chosen slot: Cloudflare's script is loaded only then. Submitted through a
 * transition rather than `action=` so that React does not clear the typed values when the action refuses them.
 */
export function BookingDetailsForm({ slug, ownerName, siteKey, eventTypeId, start, idempotencyKey, phoneRequired, answer, submit }: Props) {
  const [pending, startTransition] = useTransition();
  const { containerRef, reset } = useTurnstile(siteKey, slug, BOOKING_CHALLENGE_ACTION);
  const view = toBookingFormView(answer);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      if (needsNewChallenge(await submit(data))) {
        reset();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {view.alert !== null && (
        <p role="alert" className="rounded-md border border-destructive bg-destructive/10 p-3 text-foreground">
          {view.alert}
        </p>
      )}
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="eventTypeId" value={eventTypeId} />
      <input type="hidden" name="start" value={start} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Field
        id="booking-name"
        name="name"
        label="Nom"
        type="text"
        autoComplete="name"
        required
        maxLength={BOOKING_TEXT_MAX_LENGTH.name}
        error={view.fieldErrors.name}
      />
      <Field
        id="booking-email"
        name="email"
        label="E-mail"
        type="email"
        autoComplete="email"
        required
        maxLength={BOOKING_TEXT_MAX_LENGTH.email}
        error={view.fieldErrors.email}
      />
      <Field
        id="booking-phone"
        name="phone"
        label={phoneRequired ? "Téléphone" : "Téléphone (facultatif)"}
        type="tel"
        autoComplete="tel"
        required={phoneRequired}
        maxLength={BOOKING_TEXT_MAX_LENGTH.phone}
        error={view.fieldErrors.phone}
      />
      <TextareaField
        id="booking-message"
        name="message"
        label="Message (facultatif)"
        rows={4}
        maxLength={BOOKING_TEXT_MAX_LENGTH.message}
        error={view.fieldErrors.message}
      />
      <ConsentField id="booking-consent" label={bookingConsentLabel(ownerName)} error={view.fieldErrors.consent} />
      <div ref={containerRef} className="min-h-[65px]" />
      <Button type="submit" disabled={pending || start === ""}>
        {BOOKING_SUBMIT_LABEL}
      </Button>
      <p className="text-sm text-muted-foreground">{bookingPrivacyNotice(ownerName)}</p>
    </form>
  );
}
