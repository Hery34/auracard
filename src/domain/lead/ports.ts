import type { DeviceClass } from "@/domain/analytics/analytics-event";
import type { LeadCursor } from "@/domain/lead/lead-cursor";
import type { LeadSubmission, OwnLead } from "@/domain/lead/lead";
import type { Result } from "@/domain/shared/result";

export type CaptureLeadCommand = LeadSubmission & { slug: string; deviceClass: DeviceClass };

/** `carnet.capture_lead`: a replay of the key gives the same id and writes nothing more. */
export interface LeadCapturer {
  /** `not_found`: unknown, unpublished or refusing profile (one single answer). */
  capture(command: CaptureLeadCommand): Promise<Result<{ leadId: string }, "not_found" | "unexpected">>;
}

export type LeadPageQuery = { before: LeadCursor | null; limit: number };

/** Leads under the session (RLS), never service_role. */
export interface LeadRepository {
  /** Newest first by (createdAt, id), strictly older than `before`, at most `limit` (≤ 100); not owned → `[]`. */
  listOwn(profileId: string, page: LeadPageQuery): Promise<Result<OwnLead[], "unexpected">>;
  /** Absent or someone else's lead: success, nothing done. */
  deleteOwn(profileId: string, leadId: string): Promise<Result<void, "unexpected">>;
}
