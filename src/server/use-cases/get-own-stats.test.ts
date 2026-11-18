/**
 * Contract frozen by test-engineer (0030, decisions 2 to 4 and 6; criteria 1 to 3).
 *
 * // src/domain/shared/ports/clock.ts (architecture.md §3: Clock is a port of domain/shared)
 * export interface Clock { now(): Date }
 *
 * // src/domain/analytics/ports.ts
 * export interface DailyAggregateReader {
 *   // Rows of carnet.analytics_daily of `profileId` whose day is in `range` (inclusive), under the session (RLS):
 *   // a profile the caller cannot read gives []. Every row, never truncated by the PostgREST row limit.
 *   listOwn(profileId: string, range: DayRange): Promise<Result<DailyAggregate[], "unexpected">>;
 * }
 *
 * // src/server/use-cases/get-own-stats.ts
 * export type GetOwnStatsError = "invalid_period" | "unauthenticated" | "no_profile" | "unexpected";
 * export type GetOwnStats = (input: { period: string }) => Promise<Result<Stats, GetOwnStatsError>>;
 * export function makeGetOwnStats(deps: {
 *   auth: AuthGateway; profiles: ProfileReader; links: LinkRepository; aggregates: DailyAggregateReader; clock: Clock;
 * }): GetOwnStats;
 * // Order: parseStatsPeriod (invalid → invalid_period, no port called) → auth.currentUser (err → unexpected,
 * //   null → unauthenticated) → profiles.getOwn (err → unexpected, null → no_profile: account of another project)
 * //   → links.listOwn(own id) and aggregates.listOwn(own id, statsRange(period, parisDay(clock.now()))), any order
 * //   (err → unexpected) → buildStats. The profile read is always the caller's own: no id comes from the input.
 * // Read only: no rate limit, nothing written.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeGetOwnStats } from "@/server/use-cases/get-own-stats";

import { makeCallLog } from "../../../tests/builders/call-log";
import { fakeAuthGateway, GATEWAY_USER_EMAIL, GATEWAY_USER_ID, type FakeAuthGatewayOptions } from "../../../tests/builders/fake-auth-gateway";
import { fakeLinkRepository, type FakeLinkRepositoryOptions } from "../../../tests/builders/fake-link-repository";
import { anOwnProfile, fakeProfileReader, type FakeProfileReaderOptions } from "../../../tests/builders/fake-profile-reader";
import { PROFILE_ID } from "../../../tests/builders/fake-registrar";
import { aSavedLink, LINK_IDS } from "../../../tests/builders/links";
import {
  aDailyAggregate,
  DELETED_LINK_ID,
  fakeDailyAggregateReader,
  fixedClock,
  STATS_NOW,
  type FakeDailyAggregateReaderOptions,
} from "../../../tests/builders/stats";

const AUTHENTICATED = ok({ userId: GATEWAY_USER_ID, email: GATEWAY_USER_EMAIL });
const OTHER_PROFILE_ID = "5f4e3d2c-1b0a-4f9e-8d7c-6b5a4f3e2d1c";
const ZERO = { nfc_scan: 0, qr_scan: 0, profile_view: 0, vcard_download: 0, link_click: 0, contact_click: 0 };

function harness(
  overrides: {
    auth?: FakeAuthGatewayOptions;
    profiles?: FakeProfileReaderOptions;
    links?: FakeLinkRepositoryOptions;
    aggregates?: FakeDailyAggregateReaderOptions;
    now?: string;
  } = {},
) {
  const log = makeCallLog();
  const getOwnStats = makeGetOwnStats({
    auth: fakeAuthGateway({ log, currentUser: AUTHENTICATED, ...overrides.auth }),
    profiles: fakeProfileReader({ log, ...overrides.profiles }),
    links: fakeLinkRepository({ log, listResults: [ok([])], ...overrides.links }),
    aggregates: fakeDailyAggregateReader({ log, ...overrides.aggregates }),
    clock: fixedClock(overrides.now ?? STATS_NOW),
  });
  return { log, getOwnStats };
}

describe("getOwnStats", () => {
  it("criterion 1: session → own profile → links and aggregates of that profile over the period → Stats", async () => {
    const link = aSavedLink({ id: LINK_IDS[0], platform: "instagram", url: "https://www.instagram.com/elodie/", label: "Mes photos" });
    const { log, getOwnStats } = harness({
      links: { listResults: [ok([link])] },
      aggregates: {
        results: [
          ok([
            aDailyAggregate({ day: "2026-11-18", source: "nfc", value: 2 }),
            aDailyAggregate({ day: "2026-11-12", source: "direct", value: 3 }),
            aDailyAggregate({ day: "2026-11-18", metric: "nfc_scan", source: "nfc", value: 2 }),
            aDailyAggregate({ day: "2026-11-17", metric: "link_click", linkId: LINK_IDS[0], source: "nfc", value: 4 }),
            aDailyAggregate({ day: "2026-11-17", metric: "link_click", linkId: DELETED_LINK_ID, source: "direct", value: 1 }),
            aDailyAggregate({ day: "2026-11-16", metric: "contact_click", source: "qr", value: 1 }),
          ]),
        ],
      },
    });

    const result = await getOwnStats({ period: "7d" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.period).toBe("7d");
    expect(result.value.range).toStrictEqual({ from: "2026-11-12", to: "2026-11-18" });
    expect(result.value.totals).toStrictEqual({ ...ZERO, profile_view: 5, nfc_scan: 2, link_click: 5, contact_click: 1 });
    expect(result.value.viewsBySource).toStrictEqual({ nfc: 2, qr: 0, direct: 3 });
    expect(result.value.buckets.map((bucket) => bucket.counts.profile_view)).toStrictEqual([3, 0, 0, 0, 0, 0, 2]);
    expect(result.value.linkClicks).toStrictEqual([
      { kind: "link", linkId: LINK_IDS[0], platform: "instagram", label: "Mes photos", clicks: 4 },
      { kind: "deleted", clicks: 1 },
    ]);
    expect(log.sequence().slice(0, 2)).toStrictEqual(["auth.currentUser", "profiles.getOwn"]);
    expect(log.sequence().slice(2).sort()).toStrictEqual(["aggregates.listOwn", "links.listOwn"]);
  });

  it.each([
    ["7d", { from: "2026-11-12", to: "2026-11-18" }],
    ["30d", { from: "2026-10-20", to: "2026-11-18" }],
    ["12w", { from: "2026-08-31", to: "2026-11-18" }],
    ["12m", { from: "2025-12-01", to: "2026-11-18" }],
  ])("criterion 1: period %s → aggregates read over %j", async (period, range) => {
    const { log, getOwnStats } = harness();

    const result = await getOwnStats({ period });

    expect(result.ok && result.value.range).toStrictEqual(range);
    expect(log.inputsOf("aggregates", "listOwn")).toStrictEqual([{ profileId: PROFILE_ID, range }]);
  });

  it("decision 2: today is the Paris day of the injected clock (23:30 UTC on 18 November is 19 November in Paris)", async () => {
    const { log, getOwnStats } = harness({ now: "2026-11-18T23:30:00.000Z" });

    await getOwnStats({ period: "7d" });

    expect(log.inputsOf("aggregates", "listOwn")).toStrictEqual([{ profileId: PROFILE_ID, range: { from: "2026-11-13", to: "2026-11-19" } }]);
  });

  it("criterion 2: only the caller's own profile is read; an id slipped into the input is ignored", async () => {
    const { log, getOwnStats } = harness();
    const input = { period: "30d", profileId: OTHER_PROFILE_ID };

    await getOwnStats(input);

    expect(log.inputsOf("links", "listOwn")).toStrictEqual([{ profileId: PROFILE_ID }]);
    expect(log.inputsOf("aggregates", "listOwn")).toMatchObject([{ profileId: PROFILE_ID }]);
    expect(JSON.stringify(log.entries)).not.toContain(OTHER_PROFILE_ID);
  });

  it("criterion 2: the id read is the one of the profile returned for the session", async () => {
    const { log, getOwnStats } = harness({ profiles: { results: [ok(anOwnProfile({ id: OTHER_PROFILE_ID }))] } });

    await getOwnStats({ period: "7d" });

    expect(log.inputsOf("aggregates", "listOwn")).toMatchObject([{ profileId: OTHER_PROFILE_ID }]);
    expect(log.inputsOf("links", "listOwn")).toStrictEqual([{ profileId: OTHER_PROFILE_ID }]);
  });

  it("criterion 3: no aggregate → ok, every total at zero", async () => {
    const { getOwnStats } = harness();

    const result = await getOwnStats({ period: "12m" });

    expect(result.ok && result.value.totals).toStrictEqual(ZERO);
    expect(result.ok && result.value.buckets).toHaveLength(12);
    expect(result.ok && result.value.linkClicks).toStrictEqual([]);
  });

  it("read twice → the same result, nothing written", async () => {
    const { log, getOwnStats } = harness({ aggregates: { results: [ok([aDailyAggregate({ value: 2 })])] } });

    const first = await getOwnStats({ period: "7d" });
    const second = await getOwnStats({ period: "7d" });

    expect(second).toStrictEqual(first);
    expect(new Set(log.sequence())).toStrictEqual(new Set(["auth.currentUser", "profiles.getOwn", "links.listOwn", "aggregates.listOwn"]));
  });

  it.each(["", "7", "1y", "7D", "__proto__"])("invalid period %j → err('invalid_period'), no port called", async (period) => {
    const { log, getOwnStats } = harness();

    expect(await getOwnStats({ period })).toStrictEqual(err("invalid_period"));
    expect(log.sequence()).toStrictEqual([]);
  });

  it("no session → err('unauthenticated'), nothing read", async () => {
    const { log, getOwnStats } = harness({ auth: { currentUser: ok(null) } });

    expect(await getOwnStats({ period: "7d" })).toStrictEqual(err("unauthenticated"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it("GoTrue unreachable → err('unexpected'), nothing read", async () => {
    const { log, getOwnStats } = harness({ auth: { currentUser: err("unexpected") } });

    expect(await getOwnStats({ period: "7d" })).toStrictEqual(err("unexpected"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it("account of another project (no carnet profile) → err('no_profile'), no statistic read", async () => {
    const { log, getOwnStats } = harness({ profiles: { results: [ok(null)] } });

    expect(await getOwnStats({ period: "7d" })).toStrictEqual(err("no_profile"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser", "profiles.getOwn"]);
  });

  it("profile read failure → err('unexpected'), no statistic read", async () => {
    const { log, getOwnStats } = harness({ profiles: { results: [err("unexpected")] } });

    expect(await getOwnStats({ period: "7d" })).toStrictEqual(err("unexpected"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser", "profiles.getOwn"]);
  });

  it("aggregates read failure → err('unexpected')", async () => {
    const { getOwnStats } = harness({ aggregates: { results: [err("unexpected")] } });

    expect(await getOwnStats({ period: "7d" })).toStrictEqual(err("unexpected"));
  });

  it("links read failure → err('unexpected')", async () => {
    const { getOwnStats } = harness({ links: { listResults: [err("unexpected")] } });

    expect(await getOwnStats({ period: "7d" })).toStrictEqual(err("unexpected"));
  });
});
