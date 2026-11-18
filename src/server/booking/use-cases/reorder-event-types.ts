import { isPermutationOf, type EventType } from "@/domain/booking/event-type";
import type { EventTypeRepository } from "@/domain/booking/ports";
import type { ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, type Result } from "@/domain/shared/result";
import { authorizeProfileWrite } from "@/server/use-cases/shared/authorize-profile-write";

export type ReorderEventTypesError =
  | "unauthenticated"
  | "not_found"
  | "rate_limited"
  | "conflict"
  | "invalid_input"
  | "unexpected";

export type ReorderEventTypes = (ids: readonly string[]) => Promise<Result<EventType[], ReorderEventTypesError>>;

/** `ids`: the full order of the caller's types; a stale or forged list is a `conflict`. Replayable. */
export function makeReorderEventTypes(deps: {
  auth: AuthGateway;
  rateLimiter: RateLimiter;
  profiles: ProfileReader;
  eventTypes: EventTypeRepository;
}): ReorderEventTypes {
  return async (ids) => {
    const authorized = await authorizeProfileWrite(deps);
    if (!authorized.ok) {
      return err(authorized.error);
    }
    const { profileId } = authorized.value;
    const current = await deps.eventTypes.listOwn(profileId);
    if (!current.ok) {
      return err("unexpected");
    }
    if (!isPermutationOf(current.value.map((eventType) => eventType.id), ids)) {
      return err("conflict");
    }
    return deps.eventTypes.reorder(profileId, ids);
  };
}
