import type { AvailabilityException, AvailabilityRule } from "@/domain/booking/availability";
import type { EventType } from "@/domain/booking/event-type";
import type { AvailabilityRepository, EventTypeRepository } from "@/domain/booking/ports";
import type { ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { Clock } from "@/domain/shared/ports/clock";
import { err, ok, type Result } from "@/domain/shared/result";

export type BookingSettings = {
  timeZone: string;
  /** By position, inactive ones included. */
  eventTypes: EventType[];
  /** By weekday then start. */
  rules: AvailabilityRule[];
  /** Not ended at the clock's now, by start. */
  exceptions: AvailabilityException[];
};

export type GetBookingSettingsError = "unauthenticated" | "no_profile" | "unexpected";

export type GetBookingSettings = () => Promise<Result<BookingSettings, GetBookingSettingsError>>;

/** Settings page of the caller (read only: no rate limit). */
export function makeGetBookingSettings(deps: {
  auth: AuthGateway;
  profiles: ProfileReader;
  eventTypes: EventTypeRepository;
  availability: AvailabilityRepository;
  clock: Clock;
}): GetBookingSettings {
  return async () => {
    const user = await deps.auth.currentUser();
    if (!user.ok) {
      return err("unexpected");
    }
    if (user.value === null) {
      return err("unauthenticated");
    }
    const own = await deps.profiles.getOwn();
    if (!own.ok) {
      return err("unexpected");
    }
    if (own.value === null) {
      return err("no_profile");
    }
    const profileId = own.value.id;
    const [timeZone, eventTypes, rules, exceptions] = await Promise.all([
      deps.availability.getTimeZone(profileId),
      deps.eventTypes.listOwn(profileId),
      deps.availability.listRules(profileId),
      deps.availability.listUpcomingExceptions(profileId, deps.clock.now()),
    ]);
    if (!timeZone.ok || !eventTypes.ok || !rules.ok || !exceptions.ok) {
      return err("unexpected");
    }
    return ok({ timeZone: timeZone.value, eventTypes: eventTypes.value, rules: rules.value, exceptions: exceptions.value });
  };
}
