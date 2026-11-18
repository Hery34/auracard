/**
 * 0032 — criteria 1 to 4 and decision 10 against the local Supabase stack (carnet.leads, carnet.capture_lead of 0031;
 * PostgREST max_rows = 100 as on the shared instance). Real adapters, real use cases; the bot challenge verifier is the
 * fake implementation of its port (ADR 0008: Cloudflare is never called by the integration suite).
 *
 * Adapters under test (contract frozen by test-engineer):
 * // src/server/repositories/supabase-lead-capturer.ts
 * // makeSupabaseLeadCapturer(admin: CarnetClient): LeadCapturer — service_role, rpc("capture_lead") only.
 * // src/server/repositories/supabase-lead-repository.ts
 * // makeSupabaseLeadRepository(server: CarnetClient): LeadRepository — session client under RLS (leads_select_own,
 * // leads_delete_own), never service_role, no new SQL function (decision 10): listOwn = direct read of carnet.leads,
 * // profile_id = $1, keyset (created_at, id) < before, order created_at desc, id desc, limit ≤ 100; createdAt is the
 * // timestamptz text as returned (microseconds kept). deleteOwn = delete … where id = $2 and profile_id = $1.
 */
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { decodeLeadCursor } from "@/domain/lead/lead-cursor";
import { err, ok, type Result } from "@/domain/shared/result";
import { makeSupabaseAuthGateway } from "@/server/infrastructure/supabase/auth-gateway";
import { makeSupabaseLeadCapturer } from "@/server/repositories/supabase-lead-capturer";
import { makeSupabaseLeadRepository } from "@/server/repositories/supabase-lead-repository";
import { makeSupabaseProfileReader } from "@/server/repositories/supabase-profile-reader";
import { makeSupabaseRateLimiter } from "@/server/repositories/supabase-rate-limiter";
import { makeCaptureLead } from "@/server/use-cases/capture-lead";
import { makeDeleteOwnLead } from "@/server/use-cases/delete-own-lead";
import { makeListOwnLeads, type LeadPage } from "@/server/use-cases/list-own-leads";

import { DESKTOP_USER_AGENT } from "../builders/analytics";
import { fakeBotChallengeVerifier } from "../builders/fake-bot-challenge-verifier";
import { aCaptureLeadInput } from "../builders/lead";
import { publishProfile, spyOnClient } from "./setup/analytics";
import { deleteUsersByEmail } from "./setup/cleanup";
import { adminClient, anonClient, type CarnetClient } from "./setup/clients";
import { RUN_SECRET, UUID_PATTERN, uniqueAddress } from "./setup/fixtures";
import { insertLeads, leadEventsOf, leadsOf, outboxOf, setAcceptsLeads } from "./setup/leads";
import { createMember, createOutsider, type Member } from "./setup/members";

function mediaOrigin(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (value === undefined) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL missing (globalSetup)");
  }
  return value;
}

/** created_at text for `secondsBefore` seconds before 18/11/2026 12:00 UTC, with `micros` microseconds. */
function at(secondsBefore: number, micros: number): string {
  const iso = new Date(Date.UTC(2026, 10, 18, 12, 0, 0) - secondsBefore * 1000).toISOString().slice(0, 19);
  return `${iso}.${String(micros).padStart(6, "0")}+00:00`;
}

describe("contact form and « Mes messages » against the local Supabase stack (0032)", () => {
  const admin = adminClient();
  const emails: string[] = [];

  function track(email: string): string {
    emails.push(email);
    return email;
  }

  function capture(outcome: "passed" | "failed" | "unavailable" = "passed") {
    return makeCaptureLead({
      rateLimiter: makeSupabaseRateLimiter(admin, RUN_SECRET),
      challenge: fakeBotChallengeVerifier({ outcome }),
      leads: makeSupabaseLeadCapturer(admin),
    });
  }

  function ownerCases(session: CarnetClient) {
    const deps = {
      auth: makeSupabaseAuthGateway(session),
      profiles: makeSupabaseProfileReader(session, mediaOrigin()),
      leads: makeSupabaseLeadRepository(session),
    };
    return {
      repository: deps.leads,
      listOwnLeads: makeListOwnLeads(deps),
      deleteOwnLead: makeDeleteOwnLead({ ...deps, rateLimiter: makeSupabaseRateLimiter(admin, RUN_SECRET) }),
    };
  }

  async function publishedMember(): Promise<Member> {
    const member = await createMember(admin, track);
    await publishProfile(admin, member.profileId);
    return member;
  }

  /** A fresh visitor: own address (5/h counter), own idempotency key. */
  function visitorInput(member: Member, overrides: Parameters<typeof aCaptureLeadInput>[0] = {}) {
    return aCaptureLeadInput({ slug: member.slug, clientAddress: uniqueAddress(), idempotencyKey: randomUUID(), ...overrides });
  }

  async function allPages(listOwnLeads: ReturnType<typeof ownerCases>["listOwnLeads"]): Promise<LeadPage[]> {
    const pages: LeadPage[] = [];
    let before: string | null = null;
    for (let guard = 0; guard < 20; guard += 1) {
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

  afterEach(async () => {
    const { survivingProfileIds } = await deleteUsersByEmail(admin, emails.splice(0));

    expect(survivingProfileIds).toStrictEqual([]);
  });

  describe("criterion 1: capture through capture_lead", () => {
    it("a valid submission creates the lead, one outbox event and one lead_submitted (device class of the visitor)", async () => {
      const member = await publishedMember();
      const input = visitorInput(member, { userAgent: DESKTOP_USER_AGENT });

      const result = await capture()(input);

      expect(result.ok).toBe(true);
      const leadId = result.ok ? result.value.leadId : "";
      expect(leadId).toMatch(UUID_PATTERN);
      const leads = await leadsOf(admin, member.profileId);
      expect(leads).toHaveLength(1);
      expect(leads[0]).toMatchObject({
        id: leadId,
        name: input.name,
        email: input.email,
        message: input.message,
        idempotency_key: input.idempotencyKey,
      });
      expect(await outboxOf(admin, member.profileId)).toStrictEqual([{ type: "lead.created", payload: { lead_id: leadId } }]);
      expect(await leadEventsOf(admin, member.profileId)).toStrictEqual([{ id: leadId, device_class: "desktop" }]);
    });

    it("idempotence: double submission (same key) → the same id, one lead, one outbox event, one lead_submitted", async () => {
      const member = await publishedMember();
      const input = visitorInput(member);

      const first = await capture()(input);
      const second = await capture()(input);

      expect(first.ok).toBe(true);
      expect(second).toStrictEqual(first);
      expect(await leadsOf(admin, member.profileId)).toHaveLength(1);
      expect(await outboxOf(admin, member.profileId)).toHaveLength(1);
      expect(await leadEventsOf(admin, member.profileId)).toHaveLength(1);
    });

    it("the owner sees the captured message in its list", async () => {
      const member = await publishedMember();
      const input = visitorInput(member);
      const captured = await capture()(input);

      const page = await ownerCases(member.session).listOwnLeads({ before: undefined });

      expect(page.ok && page.value.leads).toMatchObject([
        { id: captured.ok ? captured.value.leadId : "", name: input.name, email: input.email, message: input.message },
      ]);
    });

    it("ADR 0011: the capturer only calls rpc('capture_lead') on the service_role client", async () => {
      const member = await publishedMember();
      const spy = spyOnClient(admin);

      await makeSupabaseLeadCapturer(spy.client).capture({
        slug: member.slug,
        name: "Jean",
        email: "jean@example.test",
        message: "Bonjour",
        idempotencyKey: randomUUID(),
        deviceClass: "mobile",
      });

      expect(spy.functions).toStrictEqual(["capture_lead"]);
      expect([...new Set(spy.properties)]).toStrictEqual(["rpc"]);
    });
  });

  describe("criteria 2 and 3: refusals write nothing", () => {
    it("criterion 3: unpublished profile → not_found, nothing written", async () => {
      const member = await createMember(admin, track);

      expect(await capture()(visitorInput(member))).toStrictEqual(err("not_found"));
      expect(await leadsOf(admin, member.profileId)).toStrictEqual([]);
      expect(await outboxOf(admin, member.profileId)).toStrictEqual([]);
    });

    it("criterion 3: published profile refusing messages (accepts_leads = false) → not_found, nothing written", async () => {
      const member = await publishedMember();
      await setAcceptsLeads(admin, member.profileId, false);

      expect(await capture()(visitorInput(member))).toStrictEqual(err("not_found"));
      expect(await leadsOf(admin, member.profileId)).toStrictEqual([]);
      expect(await outboxOf(admin, member.profileId)).toStrictEqual([]);
    });

    it.each([
      ["failed", "challenge_failed"],
      ["unavailable", "challenge_unavailable"],
    ] as const)("criterion 2: Turnstile %s → %s, nothing written", async (outcome, error) => {
      const member = await publishedMember();

      expect(await capture(outcome)(visitorInput(member))).toStrictEqual(err(error));
      expect(await leadsOf(admin, member.profileId)).toStrictEqual([]);
    });

    it("criterion 2: sixth message of the same address within the hour → rate_limited, still five leads", async () => {
      const member = await publishedMember();
      const address = uniqueAddress();
      const captureLead = capture();

      for (let index = 0; index < 5; index += 1) {
        expect((await captureLead(visitorInput(member, { clientAddress: address }))).ok).toBe(true);
      }
      expect(await captureLead(visitorInput(member, { clientAddress: address }))).toStrictEqual(err("rate_limited"));

      expect(await leadsOf(admin, member.profileId)).toHaveLength(5);
    });
  });

  describe("decision 10: pagination beyond PostgREST max_rows", () => {
    it("control — the local stack caps PostgREST row reads at 100", async () => {
      const member = await createMember(admin, track);
      await insertLeads(admin, member.profileId, Array.from({ length: 120 }, (_, index) => ({ createdAt: at(index, 0) })));

      const { data, error } = await admin.from("leads").select("id").eq("profile_id", member.profileId);

      expect(error).toBeNull();
      expect(data).toHaveLength(100);
    });

    it("105 messages (ties on created_at, microsecond differences) → pages of 20, newest first, nothing lost or repeated", async () => {
      const member = await createMember(admin, track);
      const rows = Array.from({ length: 105 }, (_, index) => ({
        // groups of three share one created_at; neighbouring groups differ by one microsecond or by a minute
        createdAt: at(Math.floor(index / 6) * 60, Math.floor(index / 3) % 2 === 0 ? 2 : 1),
      }));
      await insertLeads(admin, member.profileId, rows);
      const expected = (await leadsOf(admin, member.profileId)).map((lead) => lead.id);
      expect(expected).toHaveLength(105);

      const pages = await allPages(ownerCases(member.session).listOwnLeads);

      expect(pages.map((page) => page.leads.length)).toStrictEqual([20, 20, 20, 20, 20, 5]);
      const ids = pages.flatMap((page) => page.leads.map((lead) => lead.id));
      expect(new Set(ids).size).toBe(105);
      expect(ids).toStrictEqual(expected);
    });

    it("the cursor keeps the microseconds of created_at (no lead skipped one microsecond apart)", async () => {
      const member = await createMember(admin, track);
      await insertLeads(
        admin,
        member.profileId,
        Array.from({ length: 21 }, (_, index) => ({ createdAt: at(0, 999_999 - index) })),
      );

      const first = await ownerCases(member.session).listOwnLeads({ before: undefined });

      const twentieth = (await leadsOf(admin, member.profileId))[19];
      expect(decodeLeadCursor(first.ok ? first.value.older : null)).toStrictEqual({
        createdAt: twentieth?.created_at,
        id: twentieth?.id,
      });
      const second = await ownerCases(member.session).listOwnLeads({ before: first.ok ? first.value.older : null });
      expect(second.ok && second.value.leads).toHaveLength(1);
    });

    it("an invalid `before` → first page", async () => {
      const member = await createMember(admin, track);
      await insertLeads(admin, member.profileId, [{ createdAt: at(0, 0) }]);

      const page = await ownerCases(member.session).listOwnLeads({ before: "pas-un-curseur" });

      expect(page.ok && page.value.leads).toHaveLength(1);
    });
  });

  describe("criterion 4: owner only (RLS)", () => {
    it("another carnet account lists nothing of the owner's messages, even when asking for the owner's profile id", async () => {
      const owner = await createMember(admin, track);
      const other = await createMember(admin, track);
      await insertLeads(admin, owner.profileId, [{ createdAt: at(0, 0) }]);

      expect(await ownerCases(other.session).listOwnLeads({ before: undefined })).toStrictEqual(ok({ leads: [], older: null }));
      expect(await ownerCases(other.session).repository.listOwn(owner.profileId, { before: null, limit: 21 })).toStrictEqual(ok([]));
      const { data } = await other.session.from("leads").select("id");
      expect(data).toStrictEqual([]);
    });

    it("another carnet account cannot delete the owner's message (use case, adapter, direct delete)", async () => {
      const owner = await createMember(admin, track);
      const other = await createMember(admin, track);
      const [leadId] = await insertLeads(admin, owner.profileId, [{ createdAt: at(0, 0) }]);

      expect(await ownerCases(other.session).deleteOwnLead(leadId!)).toStrictEqual(ok(undefined));
      expect(await ownerCases(other.session).repository.deleteOwn(owner.profileId, leadId!)).toStrictEqual(ok(undefined));
      await other.session.from("leads").delete().eq("id", leadId!);

      expect((await leadsOf(admin, owner.profileId)).map((lead) => lead.id)).toStrictEqual([leadId]);
    });

    it("an account of another project of the instance: no_profile / not_found, reads nothing, deletes nothing", async () => {
      const owner = await createMember(admin, track);
      const outsider = await createOutsider(admin, track);
      const [leadId] = await insertLeads(admin, owner.profileId, [{ createdAt: at(0, 0) }]);
      const cases = ownerCases(outsider.session);

      expect(await cases.listOwnLeads({ before: undefined })).toStrictEqual(err("no_profile"));
      expect(await cases.deleteOwnLead(leadId!)).toStrictEqual(err("not_found"));
      expect(await cases.repository.listOwn(owner.profileId, { before: null, limit: 21 })).toStrictEqual(ok([]));
      await outsider.session.from("leads").delete().eq("id", leadId!);
      const { data } = await outsider.session.from("leads").select("id");
      expect(data).toStrictEqual([]);

      expect((await leadsOf(admin, owner.profileId)).map((lead) => lead.id)).toStrictEqual([leadId]);
    });

    it("the anonymous visitor reads nothing", async () => {
      const owner = await createMember(admin, track);
      await insertLeads(admin, owner.profileId, [{ createdAt: at(0, 0) }]);

      const { data } = await anonClient().from("leads").select("id");

      expect(data ?? []).toStrictEqual([]);
    });

    it("the owner deletes its message; executed twice → ok both times, the other messages kept", async () => {
      const owner = await createMember(admin, track);
      const [first, second] = await insertLeads(admin, owner.profileId, [{ createdAt: at(0, 0) }, { createdAt: at(60, 0) }]);
      const { deleteOwnLead } = ownerCases(owner.session);

      expect(await deleteOwnLead(first!)).toStrictEqual(ok(undefined));
      expect(await deleteOwnLead(first!)).toStrictEqual(ok(undefined));

      expect((await leadsOf(admin, owner.profileId)).map((lead) => lead.id)).toStrictEqual([second]);
    });
  });
});
