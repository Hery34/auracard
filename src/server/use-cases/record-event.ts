import {
  parseBeaconEvent,
  sourceOfServerEvent,
  type AnalyticsEvent,
  type ServerEventType,
} from "@/domain/analytics/analytics-event";
import type { EventRecorder } from "@/domain/analytics/ports";
import { classifyUserAgent } from "@/domain/analytics/user-agent";
import { SLUG_PATTERN } from "@/domain/profile/slug";
import type { IdGenerator } from "@/domain/shared/ports/id-generator";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, ok, type Result } from "@/domain/shared/result";
import { enforceRateLimits } from "@/server/use-cases/shared/enforce-rate-limits";

export type RecordOutcome = "recorded" | "ignored";

export type BeaconInput = {
  slug: string;
  id: string;
  type: string;
  source: string;
  linkId: string | null;
  userAgent: string | null;
  clientAddress: string;
};

export type RecordBeaconEvent = (input: BeaconInput) => Promise<Result<RecordOutcome, "unexpected">>;

export type ServerEventInput = { slug: string; type: ServerEventType; userAgent: string | null; clientAddress: string };

export type RecordServerEvent = (input: ServerEventInput) => Promise<Result<RecordOutcome, "unexpected">>;

async function write(events: EventRecorder, event: AnalyticsEvent): Promise<Result<RecordOutcome, "unexpected">> {
  const recorded = await events.record(event);
  return recorded.ok ? ok("recorded") : recorded;
}

/**
 * Robots first (nothing consumed), then the `beacon` counter on every request whatever the id (deduplication does not
 * protect against inflation), then validation. Refused or invalid → ignored silently.
 */
export function makeRecordBeaconEvent(deps: { rateLimiter: RateLimiter; events: EventRecorder }): RecordBeaconEvent {
  return async ({ slug, id, type, source, linkId, userAgent, clientAddress }) => {
    const deviceClass = classifyUserAgent(userAgent);
    if (deviceClass === "bot") {
      return ok("ignored");
    }
    const limited = await enforceRateLimits(deps.rateLimiter, [{ scope: "beacon", subject: clientAddress }]);
    if (!limited.ok) {
      return limited.error === "rate_limited" ? ok("ignored") : err("unexpected");
    }
    const event = parseBeaconEvent({ id, type, source, linkId });
    if (!event.ok || !SLUG_PATTERN.test(slug)) {
      return ok("ignored");
    }
    return write(deps.events, { ...event.value, slug, deviceClass });
  };
}

/** Same order with the `scan` counter; a limiter failure is ignored too: the redirection and the vCard never wait on it. */
export function makeRecordServerEvent(deps: {
  ids: IdGenerator;
  rateLimiter: RateLimiter;
  events: EventRecorder;
}): RecordServerEvent {
  return async ({ slug, type, userAgent, clientAddress }) => {
    const deviceClass = classifyUserAgent(userAgent);
    if (deviceClass === "bot") {
      return ok("ignored");
    }
    const limited = await enforceRateLimits(deps.rateLimiter, [{ scope: "scan", subject: clientAddress }]);
    if (!limited.ok || !SLUG_PATTERN.test(slug)) {
      return ok("ignored");
    }
    return write(deps.events, {
      id: deps.ids.uuid(),
      slug,
      type,
      source: sourceOfServerEvent(type),
      linkId: null,
      deviceClass,
    });
  };
}
