/**
 * Contract frozen by test-engineer (0032, decisions 5 and 10; criterion 4). Only the ports are fakes.
 *
 * // src/domain/lead/ports.ts
 * export type LeadPageQuery = { before: LeadCursor | null; limit: number };
 * export interface LeadRepository {   // session client under RLS (leads_select_own / leads_delete_own), never service_role
 *   // Leads of profileId, newest first by (createdAt desc, id desc), strictly older than `before`, at most `limit`
 *   // (limit ≤ 100: PostgREST max_rows). A profile the caller does not own gives [].
 *   listOwn(profileId: string, page: LeadPageQuery): Promise<Result<OwnLead[], "unexpected">>;
 *   // Deletes the lead if it belongs to profileId and is visible under RLS; absent or someone else's: ok, nothing done.
 *   deleteOwn(profileId: string, leadId: string): Promise<Result<void, "unexpected">>;
 * }
 *
 * // src/server/use-cases/list-own-leads.ts
 * export const LEADS_PAGE_SIZE = 20;
 * export type LeadPage = { leads: OwnLead[]; older: string | null };   // older: encodeLeadCursor of the last lead
 * //                                                                   // when older leads exist, else null
 * export type ListOwnLeadsError = "unauthenticated" | "no_profile" | "unexpected";
 * export type ListOwnLeads = (input: { before: string | null | undefined }) => Promise<Result<LeadPage, ListOwnLeadsError>>;
 * export function makeListOwnLeads(deps: { auth: AuthGateway; profiles: ProfileReader; leads: LeadRepository }): ListOwnLeads;
 * // auth.currentUser (null → unauthenticated, no read) → profiles.getOwn (null → no_profile: account of another
 * // project) → one leads.listOwn(ownProfileId, { before: decodeLeadCursor(input.before), limit: LEADS_PAGE_SIZE + 1 })
 * // (the 21st row only tells that an older page exists). Invalid `before` → first page (decision 10).
 */
import { describe, expect, it } from "vitest";

import { decodeLeadCursor, encodeLeadCursor } from "@/domain/lead/lead-cursor";
import type { OwnLead } from "@/domain/lead/lead";
import { err, ok, type Result } from "@/domain/shared/result";
import { LEADS_PAGE_SIZE, makeListOwnLeads, type LeadPage } from "@/server/use-cases/list-own-leads";

import { makeCallLog } from "../../../tests/builders/call-log";
import { fakeAuthGateway, GATEWAY_USER_EMAIL, GATEWAY_USER_ID } from "../../../tests/builders/fake-auth-gateway";
import { fakeLeadRepository } from "../../../tests/builders/fake-lead-repository";
import { anOwnProfile, fakeProfileReader } from "../../../tests/builders/fake-profile-reader";
import { anOwnLead, LEAD_PROFILE_ID, OTHER_PROFILE_ID, ownLeads } from "../../../tests/builders/lead";

const SIGNED_IN = ok({ userId: GATEWAY_USER_ID, email: GATEWAY_USER_EMAIL });

function harness(leads: Record<string, readonly OwnLead[]> = {}, options: { signedIn?: boolean; profile?: boolean; failing?: boolean } = {}) {
  const log = makeCallLog();
  const listOwnLeads = makeListOwnLeads({
    auth: fakeAuthGateway({ log, currentUser: options.signedIn === false ? ok(null) : SIGNED_IN }),
    profiles: fakeProfileReader({ log, results: [ok(options.profile === false ? null : anOwnProfile({ id: LEAD_PROFILE_ID }))] }),
    leads: fakeLeadRepository({ log, leads, failing: options.failing }),
  });
  return { log, listOwnLeads };
}

/** Follows the `older` cursors from the first page; returns every page. */
async function allPages(listOwnLeads: ReturnType<typeof harness>["listOwnLeads"]) {
  const pages: LeadPage[] = [];
  let before: string | null = null;
  for (let guard = 0; guard < 50; guard += 1) {
    const result: Result<LeadPage, string> = await listOwnLeads({ before });
    if (!result.ok) {
      throw new Error(`listOwnLeads failed: ${result.error}`);
    }
    pages.push(result.value);
    if (result.value.older === null) {
      return pages;
    }
    before = result.value.older;
  }
  throw new Error("pagination does not end");
}

describe("listOwnLeads", () => {
  it("decision 10: pages of 20", () => {
    expect(LEADS_PAGE_SIZE).toBe(20);
  });

  it("decision 5: newest first, read on the caller's own profile, one read of 21 rows", async () => {
    const leads = ownLeads(3);
    const { log, listOwnLeads } = harness({ [LEAD_PROFILE_ID]: [leads[2]!, leads[0]!, leads[1]!] });

    expect(await listOwnLeads({ before: undefined })).toStrictEqual(ok({ leads, older: null }));

    expect(log.sequence()).toStrictEqual(["auth.currentUser", "profiles.getOwn", "leads.listOwn"]);
    expect(log.inputsOf("leads", "listOwn")).toStrictEqual([{ profileId: LEAD_PROFILE_ID, before: null, limit: 21 }]);
  });

  it("no message → an empty page without older link", async () => {
    const { listOwnLeads } = harness();

    expect(await listOwnLeads({ before: undefined })).toStrictEqual(ok({ leads: [], older: null }));
  });

  it("decision 10: exactly 20 messages → one full page, no « older messages » link", async () => {
    const { listOwnLeads } = harness({ [LEAD_PROFILE_ID]: ownLeads(20) });

    const result = await listOwnLeads({ before: undefined });

    expect(result.ok && result.value.leads).toHaveLength(20);
    expect(result.ok && result.value.older).toBeNull();
  });

  it("decision 10: 21 messages → 20, then 1; the cursor is that of the 20th message", async () => {
    const leads = ownLeads(21);
    const { listOwnLeads } = harness({ [LEAD_PROFILE_ID]: leads });

    const first = await listOwnLeads({ before: undefined });

    expect(first.ok && first.value.leads).toStrictEqual(leads.slice(0, 20));
    const older = first.ok ? first.value.older : null;
    expect(decodeLeadCursor(older)).toStrictEqual({ createdAt: leads[19]!.createdAt, id: leads[19]!.id });

    const second = await listOwnLeads({ before: older });

    expect(second).toStrictEqual(ok({ leads: leads.slice(20), older: null }));
  });

  it("decision 10: beyond 100 messages (105, ties on created_at) → full pages, order kept, nothing lost or repeated", async () => {
    const leads = ownLeads(105, { tie: 7 });
    const { listOwnLeads } = harness({ [LEAD_PROFILE_ID]: leads });

    const pages = await allPages(listOwnLeads);

    expect(pages.map((page) => page.leads.length)).toStrictEqual([20, 20, 20, 20, 20, 5]);
    expect(pages.flatMap((page) => page.leads)).toStrictEqual(leads);
  });

  it("decision 10: the `before` cursor is decoded and passed to the reader", async () => {
    const leads = ownLeads(30);
    const { log, listOwnLeads } = harness({ [LEAD_PROFILE_ID]: leads });
    const cursor = { createdAt: leads[9]!.createdAt, id: leads[9]!.id };

    const result = await listOwnLeads({ before: encodeLeadCursor(cursor) });

    expect(log.inputsOf("leads", "listOwn")).toStrictEqual([{ profileId: LEAD_PROFILE_ID, before: cursor, limit: 21 }]);
    expect(result.ok && result.value.leads[0]).toStrictEqual(leads[10]);
  });

  it.each([["garbage", "pas-un-curseur"], ["empty", ""], ["null", null]])(
    "decision 10: invalid `before` (%s) → first page",
    async (_label, before) => {
      const leads = ownLeads(3);
      const { log, listOwnLeads } = harness({ [LEAD_PROFILE_ID]: leads });

      expect(await listOwnLeads({ before })).toStrictEqual(ok({ leads, older: null }));
      expect(log.inputsOf("leads", "listOwn")).toMatchObject([{ before: null }]);
    },
  );

  it("criterion 4: only the caller's own profile is read (another profile's leads are never listed)", async () => {
    const { listOwnLeads } = harness({ [OTHER_PROFILE_ID]: [anOwnLead()] });

    expect(await listOwnLeads({ before: undefined })).toStrictEqual(ok({ leads: [], older: null }));
  });

  it("not signed in → unauthenticated, nothing read", async () => {
    const { log, listOwnLeads } = harness({}, { signedIn: false });

    expect(await listOwnLeads({ before: undefined })).toStrictEqual(err("unauthenticated"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it("criterion 4: account of another project of the instance (no carnet profile) → no_profile, nothing read", async () => {
    const { log, listOwnLeads } = harness({}, { profile: false });

    expect(await listOwnLeads({ before: undefined })).toStrictEqual(err("no_profile"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser", "profiles.getOwn"]);
  });

  it("failing reader → unexpected", async () => {
    const { listOwnLeads } = harness({}, { failing: true });

    expect(await listOwnLeads({ before: undefined })).toStrictEqual(err("unexpected"));
  });
});
