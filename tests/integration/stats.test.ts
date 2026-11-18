/**
 * 0030 — criteria 1 to 3 and decision 4 against the local Supabase stack (carnet.analytics_daily of 0028).
 * Real adapters under the user's session (never service_role for the read), real use case, clock injected.
 * The aggregates are written behind the application by the service_role client, as the aggregation job would.
 *
 * Adapter under test:
 * // src/server/repositories/supabase-daily-aggregate-reader.ts
 * // makeSupabaseDailyAggregateReader(server: CarnetClient): DailyAggregateReader — server client under the session.
 * // Decision 8 (amended 18/11/2026): one call, rpc("get_own_daily_aggregates", { p_profile_id: profileId,
 * // p_from: range.from, p_to: range.to }) — a single jsonb value (rows of carnet.analytics_daily with
 * // profile_id = p_profile_id and day in [from, to], RLS analytics_daily_select_own kept as a guard), so PostgREST
 * // max_rows (100 on the shared instance and on the local stack) never truncates it; no table read, no pagination.
 * // Mapped to DailyAggregate { day, metric, linkId, source, value }.
 * Use case: makeGetOwnStats({ auth, profiles, links, aggregates, clock }).
 */
import { afterEach, describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSupabaseAuthGateway } from "@/server/infrastructure/supabase/auth-gateway";
import { makeSupabaseDailyAggregateReader } from "@/server/repositories/supabase-daily-aggregate-reader";
import { makeSupabaseLinkRepository } from "@/server/repositories/supabase-link-repository";
import { makeSupabaseProfileReader } from "@/server/repositories/supabase-profile-reader";
import { makeGetOwnStats } from "@/server/use-cases/get-own-stats";

import { aDailyAggregate, DELETED_LINK_ID, fixedClock, OTHER_DELETED_LINK_ID, STATS_TODAY } from "../builders/stats";
import { insertDailyAggregates, insertLink, spyOnClient } from "./setup/analytics";
import { deleteUsersByEmail } from "./setup/cleanup";
import { adminClient, anonClient, type CarnetClient } from "./setup/clients";
import { createMember, createOutsider, type Member } from "./setup/members";

/** 2025-11-01 → 2026-11-30: 395 days inclusive (the SQL function caps at 400), every row of memberWithKnownAggregates inside. */
const OWN_DATA_RANGE = { from: "2025-11-01", to: "2026-11-30" };

const ZERO = { nfc_scan: 0, qr_scan: 0, profile_view: 0, vcard_download: 0, link_click: 0, contact_click: 0 };

function mediaOrigin(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (value === undefined) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL missing (globalSetup)");
  }
  return value;
}

/** Test-side calendar arithmetic on "YYYY-MM-DD". */
function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

describe("statistics of the owner against the local Supabase stack (0030)", () => {
  const admin = adminClient();
  const emails: string[] = [];

  function track(email: string): string {
    emails.push(email);
    return email;
  }

  function casesOn(session: CarnetClient) {
    const aggregates = makeSupabaseDailyAggregateReader(session);
    return {
      aggregates,
      getOwnStats: makeGetOwnStats({
        auth: makeSupabaseAuthGateway(session),
        profiles: makeSupabaseProfileReader(session, mediaOrigin()),
        links: makeSupabaseLinkRepository(session),
        aggregates,
        clock: fixedClock(),
      }),
    };
  }

  /** Known aggregates around 18 November 2026 (clock of the tests), one current link, two deleted ones. */
  async function memberWithKnownAggregates(): Promise<{ member: Member; linkId: string }> {
    const member = await createMember(admin, track);
    const linkId = await insertLink(admin, member.profileId, 0);
    await insertDailyAggregates(admin, member.profileId, [
      aDailyAggregate({ day: STATS_TODAY, source: "nfc", value: 2 }),
      aDailyAggregate({ day: STATS_TODAY, source: "qr", value: 1 }),
      aDailyAggregate({ day: STATS_TODAY, source: "direct", value: 4 }),
      aDailyAggregate({ day: STATS_TODAY, metric: "nfc_scan", source: "nfc", value: 2 }),
      aDailyAggregate({ day: "2026-11-15", metric: "qr_scan", source: "qr", value: 1 }),
      aDailyAggregate({ day: "2026-11-14", metric: "vcard_download", source: "direct", value: 1 }),
      aDailyAggregate({ day: STATS_TODAY, metric: "link_click", linkId, source: "direct", value: 3 }),
      aDailyAggregate({ day: "2026-11-13", metric: "link_click", linkId: DELETED_LINK_ID, source: "nfc", value: 2 }),
      aDailyAggregate({ day: "2026-11-12", metric: "link_click", linkId: OTHER_DELETED_LINK_ID, source: "direct", value: 1 }),
      aDailyAggregate({ day: STATS_TODAY, metric: "contact_click", source: "direct", value: 1 }),
      aDailyAggregate({ day: "2026-11-16", metric: "contact_click", source: "nfc", value: 1 }),
      aDailyAggregate({ day: STATS_TODAY, metric: "lead_submitted", source: "direct", value: 5 }),
      aDailyAggregate({ day: "2026-11-10", source: "direct", value: 10 }),
      aDailyAggregate({ day: "2026-09-01", source: "direct", value: 20 }),
      aDailyAggregate({ day: "2026-08-30", source: "direct", value: 40 }),
      aDailyAggregate({ day: "2025-12-01", source: "direct", value: 80 }),
      aDailyAggregate({ day: "2025-11-30", source: "direct", value: 160 }),
    ]);
    return { member, linkId };
  }

  afterEach(async () => {
    const { survivingProfileIds } = await deleteUsersByEmail(admin, emails.splice(0));

    expect(survivingProfileIds).toStrictEqual([]);
  });

  describe("criterion 1: known aggregates → the right totals for each period and grouping", () => {
    it("7 days: every total, views by source, clicks per link with one « deleted » row for both deleted links", async () => {
      const { member, linkId } = await memberWithKnownAggregates();

      const result = await casesOn(member.session).getOwnStats({ period: "7d" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.totals).toStrictEqual({
        nfc_scan: 2,
        qr_scan: 1,
        profile_view: 7,
        vcard_download: 1,
        link_click: 6,
        contact_click: 2,
      });
      expect(result.value.viewsBySource).toStrictEqual({ nfc: 2, qr: 1, direct: 4 });
      expect(result.value.linkClicks).toStrictEqual([
        { kind: "link", linkId, platform: "linkedin", label: null, clicks: 3 },
        { kind: "deleted", clicks: 3 },
      ]);
      expect(result.value.buckets.map((bucket) => bucket.counts.link_click)).toStrictEqual([1, 2, 0, 0, 0, 0, 3]);
    });

    it.each([
      ["30d", 30, 17],
      ["12w", 12, 37],
      ["12m", 12, 157],
    ])("%s: %i buckets, views total %i", async (period, length, views) => {
      const { member } = await memberWithKnownAggregates();

      const result = await casesOn(member.session).getOwnStats({ period });

      expect(result.ok && result.value.buckets).toHaveLength(length);
      expect(result.ok && result.value.totals.profile_view).toBe(views);
    });

    it("12 weeks: the views of 1 September are in the first ISO week (31 August – 6 September)", async () => {
      const { member } = await memberWithKnownAggregates();

      const result = await casesOn(member.session).getOwnStats({ period: "12w" });

      expect(result.ok && result.value.buckets[0]).toMatchObject({ from: "2026-08-31", to: "2026-09-06", counts: { profile_view: 20 } });
    });

    it("12 months: the views of 1 December 2025 are in the first month, those of 30 November 2025 nowhere", async () => {
      const { member } = await memberWithKnownAggregates();

      const result = await casesOn(member.session).getOwnStats({ period: "12m" });

      expect(result.ok && result.value.buckets[0]).toMatchObject({ from: "2025-12-01", to: "2025-12-31", counts: { profile_view: 80 } });
    });

    it("the reader returns the rows of [from, to], both ends included, and nothing else", async () => {
      const { member } = await memberWithKnownAggregates();

      const rows = await casesOn(member.session).aggregates.listOwn(member.profileId, { from: "2026-11-10", to: "2026-11-13" });

      expect(rows.ok).toBe(true);
      expect(rows.ok && rows.value.map((row) => `${row.day}:${row.metric}:${row.value}`).sort()).toStrictEqual([
        "2026-11-10:profile_view:10",
        "2026-11-12:link_click:1",
        "2026-11-13:link_click:2",
      ]);
      expect(rows.ok && rows.value.find((row) => row.day === "2026-11-13")).toStrictEqual(
        aDailyAggregate({ day: "2026-11-13", metric: "link_click", linkId: DELETED_LINK_ID, source: "nfc", value: 2 }),
      );
    });

    it("decision 8: control — the local stack caps PostgREST row reads at 100 (max_rows of the shared instance)", async () => {
      const member = await createMember(admin, track);
      const rows = [];
      for (let day = addDays(STATS_TODAY, -39); day <= STATS_TODAY; day = addDays(day, 1)) {
        for (const source of ["nfc", "qr", "direct"] as const) {
          rows.push(aDailyAggregate({ day, source, value: 1 }));
        }
      }
      expect(rows).toHaveLength(120);
      await insertDailyAggregates(admin, member.profileId, rows);

      const { data, error } = await admin.from("analytics_daily").select("day").eq("profile_id", member.profileId);

      expect(error).toBeNull();
      expect(data).toHaveLength(100);
    });

    it("decision 8: the reader makes one call, rpc('get_own_daily_aggregates'), and reads no other property of the client", async () => {
      const { member } = await memberWithKnownAggregates();
      const spy = spyOnClient(member.session);

      const rows = await makeSupabaseDailyAggregateReader(spy.client).listOwn(member.profileId, { from: "2026-11-10", to: "2026-11-13" });

      expect(rows.ok && rows.value).toHaveLength(3);
      expect(spy.functions).toStrictEqual(["get_own_daily_aggregates"]);
      expect([...new Set(spy.properties)]).toStrictEqual(["rpc"]);
    });

    it("decision 8: the use case passes the caller's profile id — rpc('get_own_daily_aggregates', { p_profile_id, p_from, p_to })", async () => {
      const { member } = await memberWithKnownAggregates();
      const spy = spyOnClient(member.session);
      const getOwnStats = makeGetOwnStats({
        auth: makeSupabaseAuthGateway(member.session),
        profiles: makeSupabaseProfileReader(member.session, mediaOrigin()),
        links: makeSupabaseLinkRepository(member.session),
        aggregates: makeSupabaseDailyAggregateReader(spy.client),
        clock: fixedClock(),
      });

      const result = await getOwnStats({ period: "7d" });

      expect(result.ok).toBe(true);
      expect(spy.calls).toStrictEqual([
        { fn: "get_own_daily_aggregates", args: { p_profile_id: member.profileId, p_from: addDays(STATS_TODAY, -6), p_to: STATS_TODAY } },
      ]);
    });

    it("decision 8: more than 100 rows over 30 days (max_rows = 100) → nothing truncated", async () => {
      const member = await createMember(admin, track);
      const rows = [];
      for (let day = addDays(STATS_TODAY, -29); day <= STATS_TODAY; day = addDays(day, 1)) {
        for (const source of ["nfc", "qr", "direct"] as const) {
          rows.push(aDailyAggregate({ day, source, value: 1 }));
        }
        rows.push(aDailyAggregate({ day, metric: "nfc_scan", source: "nfc", value: 2 }));
      }
      expect(rows.length).toBeGreaterThan(100);
      await insertDailyAggregates(admin, member.profileId, rows);

      const listed = await casesOn(member.session).aggregates.listOwn(member.profileId, { from: addDays(STATS_TODAY, -29), to: STATS_TODAY });
      const result = await casesOn(member.session).getOwnStats({ period: "30d" });

      expect(listed.ok && listed.value).toHaveLength(rows.length);
      expect(result.ok && result.value.totals.profile_view).toBe(90);
      expect(result.ok && result.value.totals.nfc_scan).toBe(60);
      expect(result.ok && result.value.buckets.every((bucket) => bucket.counts.profile_view === 3)).toBe(true);
    });

    it("decision 8: more than 1000 rows over 12 months → nothing truncated", async () => {
      const member = await createMember(admin, track);
      const rows = [];
      for (let day = "2025-12-01"; day <= STATS_TODAY; day = addDays(day, 1)) {
        for (const source of ["nfc", "qr", "direct"] as const) {
          rows.push(aDailyAggregate({ day, source, value: 1 }));
        }
      }
      expect(rows.length).toBeGreaterThan(1000);
      await insertDailyAggregates(admin, member.profileId, rows);

      const result = await casesOn(member.session).getOwnStats({ period: "12m" });

      expect(result.ok && result.value.totals.profile_view).toBe(rows.length);
      expect(result.ok && result.value.viewsBySource).toStrictEqual({ nfc: rows.length / 3, qr: rows.length / 3, direct: rows.length / 3 });
    });

    it("read twice → the same result", async () => {
      const { member } = await memberWithKnownAggregates();
      const { getOwnStats } = casesOn(member.session);

      expect(await getOwnStats({ period: "30d" })).toStrictEqual(await getOwnStats({ period: "30d" }));
    });
  });

  describe("criterion 2: an owner never sees the figures of another profile (RLS analytics_daily)", () => {
    it("an owner passing the profile id of another owner (with aggregates) → no row", async () => {
      const { member: owner } = await memberWithKnownAggregates();
      const { member: other } = await memberWithKnownAggregates();

      const rows = await casesOn(owner.session).aggregates.listOwn(other.profileId, OWN_DATA_RANGE);

      expect(rows).toStrictEqual(ok([]));
    });

    it("another carnet member asking for the owner's profile id → no row", async () => {
      const { member: owner } = await memberWithKnownAggregates();
      const other = await createMember(admin, track);

      const rows = await casesOn(other.session).aggregates.listOwn(owner.profileId, OWN_DATA_RANGE);

      expect(rows).toStrictEqual(ok([]));
    });

    it("another carnet member → its own statistics only, all at zero", async () => {
      await memberWithKnownAggregates();
      const other = await createMember(admin, track);

      const result = await casesOn(other.session).getOwnStats({ period: "12m" });

      expect(result.ok && result.value.totals).toStrictEqual(ZERO);
      expect(result.ok && result.value.linkClicks).toStrictEqual([]);
    });

    it("an account of another project of the instance → no row, and the use case answers no_profile", async () => {
      const { member: owner } = await memberWithKnownAggregates();
      const outsider = await createOutsider(admin, track);

      const rows = await casesOn(outsider.session).aggregates.listOwn(owner.profileId, OWN_DATA_RANGE);

      expect(rows).toStrictEqual(ok([]));
      expect(await casesOn(outsider.session).getOwnStats({ period: "7d" })).toStrictEqual(err("no_profile"));
    });

    it("an anonymous visitor → no row of the owner (refused or empty)", async () => {
      const { member: owner } = await memberWithKnownAggregates();

      const rows = await makeSupabaseDailyAggregateReader(anonClient()).listOwn(owner.profileId, OWN_DATA_RANGE);

      expect(rows.ok && rows.value.length > 0).toBe(false);
    });

    it("an anonymous visitor → the use case answers unauthenticated", async () => {
      await memberWithKnownAggregates();

      expect(await casesOn(anonClient()).getOwnStats({ period: "7d" })).toStrictEqual(err("unauthenticated"));
    });

    it("control: the owner reads its own rows under its session", async () => {
      const { member: owner } = await memberWithKnownAggregates();

      const rows = await casesOn(owner.session).aggregates.listOwn(owner.profileId, OWN_DATA_RANGE);

      expect(rows.ok && rows.value).toHaveLength(17);
    });
  });

  describe("criterion 3: no data", () => {
    it("a member without any aggregate → every bucket and total at zero, its links at zero, no deleted row", async () => {
      const member = await createMember(admin, track);
      const linkId = await insertLink(admin, member.profileId, 0);

      const result = await casesOn(member.session).getOwnStats({ period: "30d" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.totals).toStrictEqual(ZERO);
      expect(result.value.buckets).toHaveLength(30);
      expect(result.value.buckets.every((bucket) => Object.values(bucket.counts).every((value) => value === 0))).toBe(true);
      expect(result.value.viewsBySource).toStrictEqual({ nfc: 0, qr: 0, direct: 0 });
      expect(result.value.linkClicks).toStrictEqual([{ kind: "link", linkId, platform: "linkedin", label: null, clicks: 0 }]);
    });
  });
});
