import { decodeLeadCursor, encodeLeadCursor } from "@/domain/lead/lead-cursor";
import type { OwnLead } from "@/domain/lead/lead";
import type { LeadRepository } from "@/domain/lead/ports";
import type { ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import { err, ok, type Result } from "@/domain/shared/result";

export const LEADS_PAGE_SIZE = 20;

/** `older`: cursor of the last lead when older leads exist, else `null`. */
export type LeadPage = { leads: OwnLead[]; older: string | null };

export type ListOwnLeadsError = "unauthenticated" | "no_profile" | "unexpected";

export type ListOwnLeads = (input: { before: string | null | undefined }) => Promise<Result<LeadPage, ListOwnLeadsError>>;

/** One page of the caller's leads, newest first; an invalid `before` gives the first page. */
export function makeListOwnLeads(deps: { auth: AuthGateway; profiles: ProfileReader; leads: LeadRepository }): ListOwnLeads {
  return async ({ before }) => {
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
    const rows = await deps.leads.listOwn(own.value.id, { before: decodeLeadCursor(before), limit: LEADS_PAGE_SIZE + 1 });
    if (!rows.ok) {
      return err("unexpected");
    }
    const leads = rows.value.slice(0, LEADS_PAGE_SIZE);
    const last = leads.at(-1);
    const older =
      rows.value.length > LEADS_PAGE_SIZE && last !== undefined
        ? encodeLeadCursor({ createdAt: last.createdAt, id: last.id })
        : null;
    return ok({ leads, older });
  };
}
