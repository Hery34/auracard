import type { LeadRepository } from "@/domain/lead/ports";
import type { OwnLead } from "@/domain/lead/lead";
import { err, ok } from "@/domain/shared/result";

import { makeCallLog, type CallLog } from "./call-log";
import { LEAD_PROFILE_ID } from "./lead";

export type FakeLeadRepositoryOptions = {
  log?: CallLog;
  /** Leads per profile id; defaults to none. */
  leads?: Readonly<Record<string, readonly OwnLead[]>>;
  failing?: boolean | undefined;
};

function newerFirst(first: OwnLead, second: OwnLead): number {
  if (first.createdAt !== second.createdAt) {
    return first.createdAt < second.createdAt ? 1 : -1;
  }
  return first.id < second.id ? 1 : first.id > second.id ? -1 : 0;
}

/**
 * In-memory leads under RLS: `listOwn` gives the leads of `profileId`, newest first by (createdAt, id), strictly older
 * than `before`, at most `limit`; `deleteOwn` removes a lead of `profileId` only (anything else: success, nothing
 * done). Timestamps of the fixtures share one format, so string order is time order.
 */
export function fakeLeadRepository(options: FakeLeadRepositoryOptions = {}): LeadRepository & {
  remaining(profileId?: string): OwnLead[];
} {
  const log = options.log ?? makeCallLog();
  const store = new Map<string, OwnLead[]>(
    Object.entries(options.leads ?? {}).map(([profileId, leads]) => [profileId, [...leads]]),
  );

  return {
    remaining(profileId = LEAD_PROFILE_ID) {
      return [...(store.get(profileId) ?? [])].sort(newerFirst);
    },
    async listOwn(profileId, page) {
      log.record("leads", "listOwn", { profileId, ...page });
      if (options.failing === true) {
        return err("unexpected");
      }
      const { before, limit } = page;
      const sorted = [...(store.get(profileId) ?? [])].sort(newerFirst);
      const older =
        before === null
          ? sorted
          : sorted.filter((lead) => lead.createdAt < before.createdAt || (lead.createdAt === before.createdAt && lead.id < before.id));
      return ok(older.slice(0, limit));
    },
    async deleteOwn(profileId, leadId) {
      log.record("leads", "deleteOwn", { profileId, leadId });
      if (options.failing === true) {
        return err("unexpected");
      }
      const leads = store.get(profileId);
      if (leads !== undefined) {
        store.set(
          profileId,
          leads.filter((lead) => lead.id !== leadId),
        );
      }
      return ok(undefined);
    },
  };
}
