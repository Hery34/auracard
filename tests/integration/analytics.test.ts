/**
 * 0029 — criteria 1 to 3 and 6, decisions 7 to 9, against the local Supabase stack (record_public_event of 0034).
 * Real adapters (event recorder, rate limiter), real use cases.
 *
 * // makeSupabaseEventRecorder(admin) — service_role client; rpc("record_public_event") only, the slug resolved by SQL.
 */
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { ok } from "@/domain/shared/result";
import { makeSupabaseEventRecorder } from "@/server/repositories/supabase-event-recorder";
import { makeSupabaseRateLimiter } from "@/server/repositories/supabase-rate-limiter";
import { makeRecordBeaconEvent, makeRecordServerEvent } from "@/server/use-cases/record-event";

import { PREVIEW_BOT_USER_AGENT, aBeaconInput, aServerEventInput } from "../builders/analytics";
import { eventsOf, insertLink, publishProfile, spyOnClient } from "./setup/analytics";
import { deleteUsersByEmail } from "./setup/cleanup";
import { adminClient } from "./setup/clients";
import { RUN_SECRET, uniqueAddress } from "./setup/fixtures";
import { createMember, type Member } from "./setup/members";

describe("statistics recording against the local Supabase stack (0029)", () => {
  const admin = adminClient();
  const emails: string[] = [];

  function track(email: string): string {
    emails.push(email);
    return email;
  }

  async function publishedMember(): Promise<Member> {
    const member = await createMember(admin, track);
    await publishProfile(admin, member.profileId);
    return member;
  }

  const recorder = () => makeSupabaseEventRecorder(admin);
  const recordBeacon = () =>
    makeRecordBeaconEvent({ rateLimiter: makeSupabaseRateLimiter(admin, RUN_SECRET), events: recorder() });
  const recordServer = () =>
    makeRecordServerEvent({
      ids: { uuid: () => randomUUID() },
      rateLimiter: makeSupabaseRateLimiter(admin, RUN_SECRET),
      events: recorder(),
    });

  function view(slug: string, id = randomUUID()) {
    return { id, slug, type: "profile_view", source: "direct", linkId: null, deviceClass: "mobile" } as const;
  }

  afterEach(async () => {
    const { survivingProfileIds } = await deleteUsersByEmail(admin, emails.splice(0));

    expect(survivingProfileIds).toStrictEqual([]);
  });

  describe("makeSupabaseEventRecorder", () => {
    it("decisions 8 and 9: one call, rpc('record_public_event'), and no other property of the client than rpc is read", async () => {
      const member = await publishedMember();
      const spy = spyOnClient(admin);
      const event = view(member.slug);

      expect(await makeSupabaseEventRecorder(spy.client).record(event)).toStrictEqual(ok(undefined));

      expect(spy.functions).toStrictEqual(["record_public_event"]);
      expect([...new Set(spy.properties)]).toStrictEqual(["rpc"]);
      expect(await eventsOf(admin, member.profileId)).toMatchObject([
        { id: event.id, type: "profile_view", source: "direct", link_id: null, device_class: "mobile" },
      ]);
    });

    it("criterion 2 / idempotence: the same id recorded twice → ok twice, one event", async () => {
      const member = await publishedMember();
      const event = { ...view(member.slug), type: "nfc_scan", source: "nfc" } as const;

      expect(await recorder().record(event)).toStrictEqual(ok(undefined));
      expect(await recorder().record(event)).toStrictEqual(ok(undefined));

      expect(await eventsOf(admin, member.profileId)).toHaveLength(1);
    });

    it("decision 5: link_click is stored with its link", async () => {
      const member = await publishedMember();
      const linkId = await insertLink(admin, member.profileId);
      const id = randomUUID();

      await recorder().record({ id, slug: member.slug, type: "link_click", source: "qr", linkId, deviceClass: "desktop" });

      expect(await eventsOf(admin, member.profileId)).toMatchObject([
        { id, type: "link_click", source: "qr", link_id: linkId, device_class: "desktop" },
      ]);
    });

    it("decision 9: unpublished profile, unknown slug, link of another profile → ok (no oracle), nothing stored", async () => {
      const unpublished = await createMember(admin, track);
      const member = await publishedMember();
      const other = await publishedMember();
      const otherLink = await insertLink(admin, other.profileId);

      expect(await recorder().record(view(unpublished.slug))).toStrictEqual(ok(undefined));
      expect(await recorder().record(view(`inconnu-${randomUUID().slice(0, 8)}`))).toStrictEqual(ok(undefined));
      expect(
        await recorder().record({ ...view(member.slug), type: "link_click", linkId: otherLink }),
      ).toStrictEqual(ok(undefined));

      expect(await eventsOf(admin, unpublished.profileId)).toStrictEqual([]);
      expect(await eventsOf(admin, member.profileId)).toStrictEqual([]);
      expect(await eventsOf(admin, other.profileId)).toStrictEqual([]);
    });
  });

  describe("recordBeaconEvent with the real limiter and recorder", () => {
    it("criterion 2: the same beacon replayed → one event", async () => {
      const member = await publishedMember();
      const record = recordBeacon();
      const input = aBeaconInput({ slug: member.slug, id: randomUUID(), source: "nfc", clientAddress: uniqueAddress() });

      expect(await record(input)).toStrictEqual(ok("recorded"));
      expect(await record(input)).toStrictEqual(ok("recorded"));

      expect(await eventsOf(admin, member.profileId)).toMatchObject([
        { id: input.id, type: "profile_view", source: "nfc", device_class: "mobile" },
      ]);
    });

    it("criterion 3: a link-preview user-agent → ignored, no event", async () => {
      const member = await publishedMember();

      const result = await recordBeacon()(
        aBeaconInput({ slug: member.slug, id: randomUUID(), userAgent: PREVIEW_BOT_USER_AGENT, clientAddress: uniqueAddress() }),
      );

      expect(result).toStrictEqual(ok("ignored"));
      expect(await eventsOf(admin, member.profileId)).toStrictEqual([]);
    });

    it(
      "criterion 6: 300 events per address per hour are kept, the 301st is ignored silently — and a replay counts too",
      { timeout: 120_000 },
      async () => {
        const member = await publishedMember();
        const record = recordBeacon();
        const clientAddress = uniqueAddress();
        const replayedId = randomUUID();

        expect(await record(aBeaconInput({ slug: member.slug, id: replayedId, clientAddress }))).toStrictEqual(ok("recorded"));
        expect(await record(aBeaconInput({ slug: member.slug, id: replayedId, clientAddress }))).toStrictEqual(ok("recorded"));
        for (let index = 3; index <= 300; index += 1) {
          expect(await record(aBeaconInput({ slug: member.slug, id: randomUUID(), clientAddress })), `event ${index}`).toStrictEqual(
            ok("recorded"),
          );
        }
        const refused = randomUUID();

        expect(await record(aBeaconInput({ slug: member.slug, id: refused, clientAddress }))).toStrictEqual(ok("ignored"));

        const events = await eventsOf(admin, member.profileId);
        expect(events).toHaveLength(299);
        expect(events.map((event) => event.id)).not.toContain(refused);
        expect(
          await record(aBeaconInput({ slug: member.slug, id: randomUUID(), clientAddress: uniqueAddress() })),
          "another address keeps its own counter",
        ).toStrictEqual(ok("recorded"));
      },
    );
  });

  describe("recordServerEvent with the real limiter and recorder", () => {
    it("criterion 1: an NFC scan of a published profile → one nfc_scan of source nfc", async () => {
      const member = await publishedMember();

      expect(await recordServer()(aServerEventInput({ slug: member.slug, clientAddress: uniqueAddress() }))).toStrictEqual(
        ok("recorded"),
      );

      expect(await eventsOf(admin, member.profileId)).toMatchObject([{ type: "nfc_scan", source: "nfc", link_id: null, device_class: "mobile" }]);
    });

    it("decision 9 / criterion 6: 60 scans per address per hour are kept, the 61st is ignored silently", { timeout: 60_000 }, async () => {
      const member = await publishedMember();
      const record = recordServer();
      const clientAddress = uniqueAddress();

      for (let index = 1; index <= 60; index += 1) {
        expect(await record(aServerEventInput({ slug: member.slug, type: "qr_scan", clientAddress })), `scan ${index}`).toStrictEqual(
          ok("recorded"),
        );
      }

      expect(await record(aServerEventInput({ slug: member.slug, type: "vcard_download", clientAddress }))).toStrictEqual(
        ok("ignored"),
      );
      expect(await eventsOf(admin, member.profileId)).toHaveLength(60);
    });
  });
});
