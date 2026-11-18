import type { LeadCapturer } from "@/domain/lead/ports";
import { err, ok } from "@/domain/shared/result";

import { makeCallLog, type CallLog } from "./call-log";
import { LEAD_IDS, LEAD_SLUG } from "./lead";

export type FakeLeadCapturerOptions = {
  log?: CallLog;
  /** Slugs of published profiles that accept messages; any other slug is `not_found` (P0002 of capture_lead). */
  accepting?: readonly string[];
  /** When true, every call fails with `err("unexpected")`. */
  failing?: boolean;
};

export type StoredLead = { id: string; slug: string; name: string; email: string; message: string; idempotencyKey: string };

/**
 * Stand-in for `carnet.capture_lead`: one lead per (slug, idempotency key); a replay of the same key returns the id
 * already stored and writes nothing more. `stored` is what the database would hold.
 */
export function fakeLeadCapturer(options: FakeLeadCapturerOptions = {}): LeadCapturer & { stored: StoredLead[] } {
  const log = options.log ?? makeCallLog();
  const accepting = options.accepting ?? [LEAD_SLUG];
  const stored: StoredLead[] = [];

  return {
    stored,
    async capture(command) {
      log.record("leads", "capture", command);
      if (options.failing === true) {
        return err("unexpected");
      }
      if (!accepting.includes(command.slug)) {
        return err("not_found");
      }
      const existing = stored.find((lead) => lead.slug === command.slug && lead.idempotencyKey === command.idempotencyKey);
      if (existing !== undefined) {
        return ok({ leadId: existing.id });
      }
      const id = LEAD_IDS[stored.length];
      if (id === undefined) {
        throw new Error("fakeLeadCapturer: out of ids");
      }
      const { slug, name, email, message, idempotencyKey } = command;
      stored.push({ id, slug, name, email, message, idempotencyKey });
      return ok({ leadId: id });
    },
  };
}
