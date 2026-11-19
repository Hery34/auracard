import { ICS_FILE_NAME, type BookingConfirmation } from "@/ui/features/booking/booking-confirmation";
import { ADD_TO_CALENDAR_LABEL, CANCELLATION_REMINDER } from "@/ui/features/booking/public-messages";
import { buttonVariants } from "@/ui/primitives/button";

/** Decision 5: recap, calendar file and the reminder that the e-mail carries the cancellation link. */
export function BookingConfirmationView({ confirmation }: { confirmation: BookingConfirmation }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="font-medium">Rendez-vous</dt>
        <dd>{confirmation.title}</dd>
        <dt className="font-medium">Date</dt>
        <dd>
          {confirmation.day} à {confirmation.time}
        </dd>
        {confirmation.location !== null && (
          <>
            <dt className="font-medium">Lieu</dt>
            <dd className="break-words">{confirmation.location}</dd>
          </>
        )}
      </dl>
      {confirmation.icsHref !== null && (
        <a href={confirmation.icsHref} download={ICS_FILE_NAME} className={buttonVariants({ variant: "outline" })}>
          {ADD_TO_CALENDAR_LABEL}
        </a>
      )}
      <p>{CANCELLATION_REMINDER}</p>
    </section>
  );
}
