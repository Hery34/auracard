/**
 * Contract frozen by test-engineer (0032, decision 5; criterion 4). Only the ports are fakes.
 *
 * // src/server/use-cases/delete-own-lead.ts
 * export type DeleteOwnLeadError = "unauthenticated" | "not_found" | "rate_limited" | "unexpected";
 * export type DeleteOwnLead = (leadId: string) => Promise<Result<void, DeleteOwnLeadError>>;
 * export function makeDeleteOwnLead(deps: { auth: AuthGateway; rateLimiter: RateLimiter; profiles: ProfileReader;
 *   leads: LeadRepository }): DeleteOwnLead;
 * // authorizeProfileWrite (session → "profile-write" counter of the account → own profile; no profile: not_found),
 * // then leads.deleteOwn(ownProfileId, leadId). Idempotent: already deleted, or someone else's lead → ok, nothing
 * // done (no oracle). The target profile is never taken from the input.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeDeleteOwnLead } from "@/server/use-cases/delete-own-lead";

import { makeCallLog } from "../../../tests/builders/call-log";
import { fakeAuthGateway, GATEWAY_USER_EMAIL, GATEWAY_USER_ID } from "../../../tests/builders/fake-auth-gateway";
import { fakeLeadRepository } from "../../../tests/builders/fake-lead-repository";
import { anOwnProfile, fakeProfileReader } from "../../../tests/builders/fake-profile-reader";
import { fakeRateLimiter, type FakeRateLimiterOptions } from "../../../tests/builders/fake-rate-limiter";
import { anOwnLead, LEAD_IDS, LEAD_PROFILE_ID, OTHER_PROFILE_ID } from "../../../tests/builders/lead";

const SIGNED_IN = ok({ userId: GATEWAY_USER_ID, email: GATEWAY_USER_EMAIL });

function harness(
  options: { signedIn?: boolean; profile?: boolean; limiter?: Omit<FakeRateLimiterOptions, "log">; failing?: boolean } = {},
) {
  const log = makeCallLog();
  const leads = fakeLeadRepository({
    log,
    failing: options.failing,
    leads: {
      [LEAD_PROFILE_ID]: [anOwnLead({ id: LEAD_IDS[0] }), anOwnLead({ id: LEAD_IDS[1] })],
      [OTHER_PROFILE_ID]: [anOwnLead({ id: LEAD_IDS[2] })],
    },
  });
  const deleteOwnLead = makeDeleteOwnLead({
    auth: fakeAuthGateway({ log, currentUser: options.signedIn === false ? ok(null) : SIGNED_IN }),
    rateLimiter: fakeRateLimiter({ log, ...options.limiter }),
    profiles: fakeProfileReader({ log, results: [ok(options.profile === false ? null : anOwnProfile({ id: LEAD_PROFILE_ID }))] }),
    leads,
  });
  return { log, leads, deleteOwnLead };
}

describe("deleteOwnLead", () => {
  it("criterion 4: the owner deletes one of its messages (session → profile-write counter → own profile → delete)", async () => {
    const { log, leads, deleteOwnLead } = harness();

    expect(await deleteOwnLead(LEAD_IDS[0])).toStrictEqual(ok(undefined));

    expect(log.sequence()).toStrictEqual(["auth.currentUser", "rateLimiter.consume", "profiles.getOwn", "leads.deleteOwn"]);
    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([
      { scope: "profile-write", subject: GATEWAY_USER_ID, limit: 60, windowSeconds: 3600 },
    ]);
    expect(log.inputsOf("leads", "deleteOwn")).toStrictEqual([{ profileId: LEAD_PROFILE_ID, leadId: LEAD_IDS[0] }]);
    expect(leads.remaining().map((lead) => lead.id)).toStrictEqual([LEAD_IDS[1]]);
  });

  it("idempotence: executed twice → ok both times, one deletion", async () => {
    const { leads, deleteOwnLead } = harness();

    expect(await deleteOwnLead(LEAD_IDS[0])).toStrictEqual(ok(undefined));
    expect(await deleteOwnLead(LEAD_IDS[0])).toStrictEqual(ok(undefined));

    expect(leads.remaining().map((lead) => lead.id)).toStrictEqual([LEAD_IDS[1]]);
  });

  it("criterion 4: another profile's message → ok (no oracle), never deleted; the target is the caller's profile", async () => {
    const { log, leads, deleteOwnLead } = harness();

    expect(await deleteOwnLead(LEAD_IDS[2])).toStrictEqual(ok(undefined));

    expect(log.inputsOf("leads", "deleteOwn")).toStrictEqual([{ profileId: LEAD_PROFILE_ID, leadId: LEAD_IDS[2] }]);
    expect(leads.remaining(OTHER_PROFILE_ID).map((lead) => lead.id)).toStrictEqual([LEAD_IDS[2]]);
  });

  it("not signed in → unauthenticated, nothing deleted", async () => {
    const { log, deleteOwnLead } = harness({ signedIn: false });

    expect(await deleteOwnLead(LEAD_IDS[0])).toStrictEqual(err("unauthenticated"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it("criterion 4: account of another project (no carnet profile) → not_found, nothing deleted", async () => {
    const { log, deleteOwnLead } = harness({ profile: false });

    expect(await deleteOwnLead(LEAD_IDS[2])).toStrictEqual(err("not_found"));
    expect(log.inputsOf("leads", "deleteOwn")).toStrictEqual([]);
  });

  it("profile-write counter exhausted → rate_limited, nothing deleted", async () => {
    const { log, deleteOwnLead } = harness({ limiter: { deny: ["profile-write"] } });

    expect(await deleteOwnLead(LEAD_IDS[0])).toStrictEqual(err("rate_limited"));
    expect(log.inputsOf("leads", "deleteOwn")).toStrictEqual([]);
  });

  it("failing repository → unexpected", async () => {
    const { deleteOwnLead } = harness({ failing: true });

    expect(await deleteOwnLead(LEAD_IDS[0])).toStrictEqual(err("unexpected"));
  });
});
