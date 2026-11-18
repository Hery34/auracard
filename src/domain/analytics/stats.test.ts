/**
 * Contract frozen by test-engineer (0030, decisions 2, 3 and 6; criteria 1 and 3).
 *
 * // src/domain/analytics/stats.ts — pure TypeScript, no clock read: "today" is always an argument.
 * export const STATS_PERIODS = ["7d", "30d", "12w", "12m"] as const;
 * export type StatsPeriod = (typeof STATS_PERIODS)[number];
 * export const DEFAULT_STATS_PERIOD: StatsPeriod; // "30d"
 * export function parseStatsPeriod(value: string): Result<StatsPeriod, "invalid_period">; // exact match only
 *
 * // The six metrics shown (decision 6); `lead_submitted` is not one of them.
 * export const STATS_METRICS = ["nfc_scan", "qr_scan", "profile_view", "vcard_download", "link_click", "contact_click"] as const;
 * export type StatsMetric = (typeof STATS_METRICS)[number];
 * export type MetricCounts = Readonly<Record<StatsMetric, number>>;
 *
 * // Calendar days of Europe/Paris as "YYYY-MM-DD"; a range is inclusive at both ends.
 * export type DayRange = { from: string; to: string };
 * export function parisDay(instant: Date): string;
 *
 * // One row of carnet.analytics_daily.
 * export type DailyAggregate = {
 *   day: string; metric: AnalyticsEventType; linkId: string | null; source: AnalyticsSource | null; value: number;
 * };
 *
 * // Buckets of the period, oldest first, contiguous, today included, never a future day:
 * //   7d → 7 days; 30d → 30 days; 12w → 12 ISO weeks (Monday → Sunday, the current one ends today);
 * //   12m → 12 calendar months (the current one ends today).
 * export function statsBuckets(period: StatsPeriod, today: string): DayRange[];
 * // { from: first day of the first bucket, to: today }.
 * export function statsRange(period: StatsPeriod, today: string): DayRange;
 *
 * export type StatsBucket = DayRange & { counts: MetricCounts };
 * export type LinkClickRow =
 *   | { kind: "link"; linkId: string; platform: LinkPlatform; label: string | null; clicks: number }
 *   | { kind: "deleted"; clicks: number };
 * export type Stats = {
 *   period: StatsPeriod;
 *   range: DayRange;
 *   buckets: StatsBucket[];                               // every bucket, zero when no data
 *   totals: MetricCounts;                                 // over the range
 *   viewsBySource: Readonly<Record<AnalyticsSource, number>>; // profile_view only
 *   linkClicks: LinkClickRow[];                           // current links by position (zero included), then one
 *                                                         // "deleted" row for every unknown link_id, only when > 0
 *   empty: boolean;                                       // decision 8: true when every total of STATS_METRICS is 0
 *                                                         // over the range (domain rule, not computed by the view)
 * };
 * // Aggregates outside the range and `lead_submitted` are ignored; inputs are never mutated.
 * export function buildStats(input: {
 *   period: StatsPeriod; today: string; aggregates: readonly DailyAggregate[]; links: readonly SavedLink[];
 * }): Stats;
 */
import { describe, expect, it } from "vitest";

import {
  buildStats,
  DEFAULT_STATS_PERIOD,
  parisDay,
  parseStatsPeriod,
  STATS_METRICS,
  STATS_PERIODS,
  statsBuckets,
  statsRange,
  type DailyAggregate,
  type DayRange,
  type MetricCounts,
} from "@/domain/analytics/stats";
import { err, ok } from "@/domain/shared/result";

import { aSavedLink, LINK_IDS } from "../../../tests/builders/links";
import { aDailyAggregate, DELETED_LINK_ID, OTHER_DELETED_LINK_ID, STATS_TODAY } from "../../../tests/builders/stats";

const ZERO: MetricCounts = {
  nfc_scan: 0,
  qr_scan: 0,
  profile_view: 0,
  vcard_download: 0,
  link_click: 0,
  contact_click: 0,
};

function counts(overrides: Partial<MetricCounts> = {}): MetricCounts {
  return { ...ZERO, ...overrides };
}

/** Test-side calendar arithmetic on "YYYY-MM-DD" (UTC dates, no time zone involved). */
function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

function weekday(day: string): number {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
}

function expectContiguous(buckets: readonly DayRange[]): void {
  for (let index = 1; index < buckets.length; index += 1) {
    expect(buckets[index]?.from, `bucket ${index} starts the day after bucket ${index - 1}`).toBe(
      addDays(buckets[index - 1]?.to ?? "", 1),
    );
  }
}

function stats(input: { period?: (typeof STATS_PERIODS)[number]; today?: string; aggregates?: DailyAggregate[]; links?: ReturnType<typeof aSavedLink>[] }) {
  return buildStats({
    period: input.period ?? "7d",
    today: input.today ?? STATS_TODAY,
    aggregates: input.aggregates ?? [],
    links: input.links ?? [],
  });
}

describe("parseStatsPeriod (decision 2)", () => {
  it.each(["7d", "30d", "12w", "12m"])("accepts %j", (value) => {
    expect(parseStatsPeriod(value)).toStrictEqual(ok(value));
  });

  it.each(["", "7", "7D", " 7d", "7d ", "1y", "90d", "12W", "week", "constructor", "__proto__"])(
    "refuses %j with invalid_period",
    (value) => {
      expect(parseStatsPeriod(value)).toStrictEqual(err("invalid_period"));
    },
  );

  it("the four periods, in display order; 30 days by default", () => {
    expect(STATS_PERIODS).toStrictEqual(["7d", "30d", "12w", "12m"]);
    expect(DEFAULT_STATS_PERIOD).toBe("30d");
  });
});

describe("parisDay: calendar day in Europe/Paris (decision 2)", () => {
  it.each([
    ["winter, last second of the day (23:59:59 CET)", "2026-11-18T22:59:59Z", "2026-11-18"],
    ["winter, midnight CET is 23:00 UTC the day before", "2026-11-18T23:00:00Z", "2026-11-19"],
    ["summer, last second of the day (23:59:59 CEST)", "2026-07-14T21:59:59Z", "2026-07-14"],
    ["summer, midnight CEST is 22:00 UTC the day before", "2026-07-14T22:00:00Z", "2026-07-15"],
    ["spring forward: 01:59:59 CET just before the switch", "2026-03-29T00:59:59Z", "2026-03-29"],
    ["spring forward: 03:00 CEST just after the switch", "2026-03-29T01:00:00Z", "2026-03-29"],
    ["spring forward: 23:59:59 CEST, end of the 23-hour day", "2026-03-29T21:59:59Z", "2026-03-29"],
    ["spring forward: midnight CEST of the next day", "2026-03-29T22:00:00Z", "2026-03-30"],
    ["fall back: midnight CEST, start of the 25-hour day", "2026-10-24T22:00:00Z", "2026-10-25"],
    ["fall back: 23:59:59 CET, end of the 25-hour day", "2026-10-25T22:59:59Z", "2026-10-25"],
    ["fall back: midnight CET of the next day", "2026-10-25T23:00:00Z", "2026-10-26"],
    ["new year in Paris while still 31 December in UTC", "2026-12-31T23:00:00Z", "2027-01-01"],
  ])("%s: %s → %s", (_label, instant, day) => {
    expect(parisDay(new Date(instant))).toBe(day);
  });
});

describe("statsBuckets and statsRange: 7 days by day (decision 2)", () => {
  it("seven single days ending today, oldest first", () => {
    expect(statsBuckets("7d", "2026-11-18")).toStrictEqual(
      ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18"].map((day) => ({
        from: day,
        to: day,
      })),
    );
    expect(statsRange("7d", "2026-11-18")).toStrictEqual({ from: "2026-11-12", to: "2026-11-18" });
  });

  it("across a year boundary", () => {
    expect(statsRange("7d", "2027-01-03")).toStrictEqual({ from: "2026-12-28", to: "2027-01-03" });
  });

  it("across the spring switch (23-hour day): still seven distinct days, none skipped", () => {
    const today = parisDay(new Date("2026-03-30T22:30:00Z"));

    expect(today).toBe("2026-03-31");
    expect(statsBuckets("7d", today).map((bucket) => bucket.from)).toStrictEqual([
      "2026-03-25",
      "2026-03-26",
      "2026-03-27",
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
      "2026-03-31",
    ]);
  });

  it("across the autumn switch (25-hour day): still seven distinct days, none repeated", () => {
    const today = parisDay(new Date("2026-10-25T23:30:00Z"));

    expect(today).toBe("2026-10-26");
    expect(statsBuckets("7d", today).map((bucket) => bucket.from)).toStrictEqual([
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
    ]);
  });
});

describe("statsBuckets and statsRange: 30 days by day (decision 2)", () => {
  it("thirty single days ending today", () => {
    const buckets = statsBuckets("30d", "2026-11-18");

    expect(buckets).toHaveLength(30);
    expect(buckets[0]).toStrictEqual({ from: "2026-10-20", to: "2026-10-20" });
    expect(buckets[29]).toStrictEqual({ from: "2026-11-18", to: "2026-11-18" });
    expect(buckets.every((bucket) => bucket.from === bucket.to)).toBe(true);
    expectContiguous(buckets);
  });

  it("across February of a common year", () => {
    expect(statsRange("30d", "2026-03-01")).toStrictEqual({ from: "2026-01-31", to: "2026-03-01" });
  });

  it("across February of a leap year", () => {
    expect(statsRange("30d", "2028-03-01")).toStrictEqual({ from: "2028-02-01", to: "2028-03-01" });
  });
});

describe("statsBuckets and statsRange: 12 ISO weeks (decision 2)", () => {
  it("Wednesday → twelve weeks Monday to Sunday, the current one ends today", () => {
    const buckets = statsBuckets("12w", "2026-11-18");

    expect(buckets).toHaveLength(12);
    expect(buckets[0]).toStrictEqual({ from: "2026-08-31", to: "2026-09-06" });
    expect(buckets[10]).toStrictEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(buckets[11]).toStrictEqual({ from: "2026-11-16", to: "2026-11-18" });
    expect(statsRange("12w", "2026-11-18")).toStrictEqual({ from: "2026-08-31", to: "2026-11-18" });
  });

  it("every bucket starts on a Monday; every full bucket is seven days, autumn switch included", () => {
    const buckets = statsBuckets("12w", "2026-11-18");

    expect(buckets.map((bucket) => weekday(bucket.from))).toStrictEqual(Array(12).fill(1));
    for (const bucket of buckets.slice(0, -1)) {
      expect(bucket.to).toBe(addDays(bucket.from, 6));
    }
    expect(buckets).toContainEqual({ from: "2026-10-19", to: "2026-10-25" });
    expectContiguous(buckets);
  });

  it("today is a Monday → the current week is today alone", () => {
    expect(statsBuckets("12w", "2026-11-16").at(-1)).toStrictEqual({ from: "2026-11-16", to: "2026-11-16" });
    expect(statsRange("12w", "2026-11-16")).toStrictEqual({ from: "2026-08-31", to: "2026-11-16" });
  });

  it("today is a Sunday → the current week is complete", () => {
    expect(statsBuckets("12w", "2026-11-22").at(-1)).toStrictEqual({ from: "2026-11-16", to: "2026-11-22" });
  });

  it("2 January 2026: ISO week 1 starts on Monday 29 December 2025", () => {
    const buckets = statsBuckets("12w", "2026-01-02");

    expect(buckets[0]).toStrictEqual({ from: "2025-10-13", to: "2025-10-19" });
    expect(buckets[11]).toStrictEqual({ from: "2025-12-29", to: "2026-01-02" });
  });

  it("1 January 2027 falls in ISO week 53 of 2026 (Monday 28 December)", () => {
    const buckets = statsBuckets("12w", "2027-01-01");

    expect(buckets[10]).toStrictEqual({ from: "2026-12-21", to: "2026-12-27" });
    expect(buckets[11]).toStrictEqual({ from: "2026-12-28", to: "2027-01-01" });
  });

  it("spring switch inside a week: Monday 23 to Sunday 29 March 2026, seven days", () => {
    expect(statsBuckets("12w", "2026-04-01")).toContainEqual({ from: "2026-03-23", to: "2026-03-29" });
  });
});

describe("statsBuckets and statsRange: 12 months (decision 2)", () => {
  it("twelve calendar months, the current one ends today", () => {
    const buckets = statsBuckets("12m", "2026-11-18");

    expect(buckets).toHaveLength(12);
    expect(buckets[0]).toStrictEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(buckets[1]).toStrictEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(buckets[2]).toStrictEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(buckets[10]).toStrictEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(buckets[11]).toStrictEqual({ from: "2026-11-01", to: "2026-11-18" });
    expect(statsRange("12m", "2026-11-18")).toStrictEqual({ from: "2025-12-01", to: "2026-11-18" });
    expectContiguous(buckets);
  });

  it("across a year boundary: January 2026 → from February 2025", () => {
    const buckets = statsBuckets("12m", "2026-01-15");

    expect(buckets[0]).toStrictEqual({ from: "2025-02-01", to: "2025-02-28" });
    expect(buckets[11]).toStrictEqual({ from: "2026-01-01", to: "2026-01-15" });
  });

  it("leap year: February 2028 ends on the 29th", () => {
    expect(statsBuckets("12m", "2028-03-10")).toContainEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("today is the first of the month → the current month is today alone", () => {
    expect(statsBuckets("12m", "2026-11-01").at(-1)).toStrictEqual({ from: "2026-11-01", to: "2026-11-01" });
  });

  it("31 December → exactly the calendar year", () => {
    expect(statsRange("12m", "2026-12-31")).toStrictEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("buildStats: series (criterion 1, decision 2)", () => {
  it("days without data are buckets at zero (7 days, data on one day only)", () => {
    const result = stats({ aggregates: [aDailyAggregate({ day: "2026-11-16", value: 3 })] });

    expect(result.buckets.map((bucket) => bucket.counts.profile_view)).toStrictEqual([0, 0, 0, 0, 3, 0, 0]);
    expect(result.buckets[0]).toStrictEqual({ from: "2026-11-12", to: "2026-11-12", counts: ZERO });
  });

  it("one day sums every source and every link of a metric", () => {
    const result = stats({
      aggregates: [
        aDailyAggregate({ source: "nfc", value: 3 }),
        aDailyAggregate({ source: "qr", value: 2 }),
        aDailyAggregate({ source: "direct", value: 5 }),
        aDailyAggregate({ metric: "link_click", linkId: LINK_IDS[0], source: "nfc", value: 1 }),
        aDailyAggregate({ metric: "link_click", linkId: LINK_IDS[1], source: "direct", value: 4 }),
      ],
      links: [aSavedLink({ id: LINK_IDS[0] }), aSavedLink({ id: LINK_IDS[1], position: 1 })],
    });

    expect(result.buckets.at(-1)?.counts).toStrictEqual(counts({ profile_view: 10, link_click: 5 }));
  });

  it("today is included", () => {
    const result = stats({ aggregates: [aDailyAggregate({ day: STATS_TODAY, metric: "nfc_scan", source: "nfc", value: 2 })] });

    expect(result.buckets.at(-1)?.counts.nfc_scan).toBe(2);
    expect(result.totals.nfc_scan).toBe(2);
  });

  it("a day before the range or after today is ignored", () => {
    const result = stats({
      aggregates: [aDailyAggregate({ day: "2026-11-11", value: 7 }), aDailyAggregate({ day: "2026-11-19", value: 9 })],
    });

    expect(result.totals).toStrictEqual(ZERO);
    expect(result.buckets.every((bucket) => bucket.counts.profile_view === 0)).toBe(true);
  });

  it("30 days: data on the first and last day of the range", () => {
    const result = stats({
      period: "30d",
      aggregates: [aDailyAggregate({ day: "2026-10-20", value: 1 }), aDailyAggregate({ day: "2026-10-19", value: 100 })],
    });

    expect(result.buckets).toHaveLength(30);
    expect(result.buckets[0]?.counts.profile_view).toBe(1);
    expect(result.totals.profile_view).toBe(1);
  });

  it("12 weeks: Monday and Sunday of the same week add up; the next Monday opens the next bucket", () => {
    const result = stats({
      period: "12w",
      aggregates: [
        aDailyAggregate({ day: "2026-11-02", value: 1 }),
        aDailyAggregate({ day: "2026-11-08", value: 2 }),
        aDailyAggregate({ day: "2026-11-09", value: 4 }),
      ],
    });

    expect(result.buckets).toHaveLength(12);
    expect(result.buckets.map((bucket) => bucket.counts.profile_view)).toStrictEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 4, 0]);
    expect(result.buckets[9]).toMatchObject({ from: "2026-11-02", to: "2026-11-08" });
  });

  it("12 weeks: the day before the first Monday is outside the range", () => {
    const result = stats({ period: "12w", aggregates: [aDailyAggregate({ day: "2026-08-30", value: 5 }), aDailyAggregate({ day: "2026-08-31", value: 1 })] });

    expect(result.range).toStrictEqual({ from: "2026-08-31", to: "2026-11-18" });
    expect(result.totals.profile_view).toBe(1);
  });

  it("12 months: 31 October and 1 November are two months; 30 November 2025 is outside", () => {
    const result = stats({
      period: "12m",
      aggregates: [
        aDailyAggregate({ day: "2026-10-31", value: 1 }),
        aDailyAggregate({ day: "2026-11-01", value: 2 }),
        aDailyAggregate({ day: "2025-12-01", value: 4 }),
        aDailyAggregate({ day: "2025-11-30", value: 8 }),
      ],
    });

    expect(result.buckets.map((bucket) => bucket.counts.profile_view)).toStrictEqual([4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2]);
    expect(result.totals.profile_view).toBe(7);
  });

  it("12 months: 29 February 2028 falls in February", () => {
    const result = stats({ period: "12m", today: "2028-03-10", aggregates: [aDailyAggregate({ day: "2028-02-29", value: 6 })] });

    expect(result.buckets[10]).toStrictEqual({ from: "2028-02-01", to: "2028-02-29", counts: counts({ profile_view: 6 }) });
  });
});

describe("buildStats: totals (criterion 1, decisions 3 and 6)", () => {
  it("one total per metric shown, equal to the sum of the buckets; lead_submitted is not one of them", () => {
    const result = stats({
      period: "30d",
      aggregates: [
        aDailyAggregate({ day: "2026-11-01", metric: "nfc_scan", source: "nfc", value: 4 }),
        aDailyAggregate({ day: "2026-11-18", metric: "nfc_scan", source: "nfc", value: 1 }),
        aDailyAggregate({ day: "2026-11-02", metric: "qr_scan", source: "qr", value: 2 }),
        aDailyAggregate({ day: "2026-11-03", metric: "vcard_download", source: "direct", value: 3 }),
        aDailyAggregate({ day: "2026-11-04", metric: "lead_submitted", source: "direct", value: 9 }),
      ],
    });

    expect(STATS_METRICS).toStrictEqual(["nfc_scan", "qr_scan", "profile_view", "vcard_download", "link_click", "contact_click"]);
    expect(result.totals).toStrictEqual(counts({ nfc_scan: 5, qr_scan: 2, vcard_download: 3 }));
    for (const metric of STATS_METRICS) {
      expect(result.buckets.reduce((sum, bucket) => sum + bucket.counts[metric], 0), metric).toBe(result.totals[metric]);
    }
  });

  it("decision 6: a single contact total, whatever the source; no detail per target", () => {
    const result = stats({
      aggregates: [
        aDailyAggregate({ metric: "contact_click", source: "nfc", value: 1 }),
        aDailyAggregate({ metric: "contact_click", source: "qr", value: 2 }),
        aDailyAggregate({ day: "2026-11-15", metric: "contact_click", source: "direct", value: 4 }),
      ],
    });

    expect(result.totals.contact_click).toBe(7);
    expect(Object.keys(result.totals).sort()).toStrictEqual([...STATS_METRICS].sort());
  });

  it("the total of link clicks includes the clicks on deleted links", () => {
    const result = stats({
      aggregates: [
        aDailyAggregate({ metric: "link_click", linkId: LINK_IDS[0], value: 2 }),
        aDailyAggregate({ metric: "link_click", linkId: DELETED_LINK_ID, value: 3 }),
      ],
      links: [aSavedLink({ id: LINK_IDS[0] })],
    });

    expect(result.totals.link_click).toBe(5);
  });
});

describe("buildStats: views by source (decision 3)", () => {
  it("profile_view only, split into nfc, qr and direct", () => {
    const result = stats({
      aggregates: [
        aDailyAggregate({ source: "nfc", value: 3 }),
        aDailyAggregate({ day: "2026-11-13", source: "nfc", value: 1 }),
        aDailyAggregate({ source: "qr", value: 2 }),
        aDailyAggregate({ source: "direct", value: 5 }),
        aDailyAggregate({ metric: "nfc_scan", source: "nfc", value: 50 }),
        aDailyAggregate({ metric: "link_click", linkId: LINK_IDS[0], source: "qr", value: 50 }),
        aDailyAggregate({ day: "2026-11-11", source: "direct", value: 50 }),
      ],
    });

    expect(result.viewsBySource).toStrictEqual({ nfc: 4, qr: 2, direct: 5 });
  });

  it("no view → every source at zero", () => {
    expect(stats({}).viewsBySource).toStrictEqual({ nfc: 0, qr: 0, direct: 0 });
  });
});

describe("buildStats: clicks per link (decision 3)", () => {
  const instagram = aSavedLink({ id: LINK_IDS[0], platform: "instagram", url: "https://www.instagram.com/elodie/", label: "Mes photos", position: 0 });
  const linkedin = aSavedLink({ id: LINK_IDS[1], platform: "linkedin", label: null, position: 1 });
  const github = aSavedLink({ id: LINK_IDS[2], platform: "github", url: "https://github.com/elodie", label: "Code", position: 2 });

  it("current links by position with their current label, zero included; unknown link_ids in one deleted row, last", () => {
    const result = stats({
      aggregates: [
        aDailyAggregate({ metric: "link_click", linkId: LINK_IDS[2], source: "nfc", value: 1 }),
        aDailyAggregate({ day: "2026-11-14", metric: "link_click", linkId: LINK_IDS[2], source: "direct", value: 2 }),
        aDailyAggregate({ metric: "link_click", linkId: LINK_IDS[0], source: "qr", value: 4 }),
        aDailyAggregate({ metric: "link_click", linkId: DELETED_LINK_ID, source: "direct", value: 2 }),
        aDailyAggregate({ day: "2026-11-13", metric: "link_click", linkId: OTHER_DELETED_LINK_ID, source: "nfc", value: 3 }),
      ],
      links: [github, instagram, linkedin],
    });

    expect(result.linkClicks).toStrictEqual([
      { kind: "link", linkId: LINK_IDS[0], platform: "instagram", label: "Mes photos", clicks: 4 },
      { kind: "link", linkId: LINK_IDS[1], platform: "linkedin", label: null, clicks: 0 },
      { kind: "link", linkId: LINK_IDS[2], platform: "github", label: "Code", clicks: 3 },
      { kind: "deleted", clicks: 5 },
    ]);
  });

  it("no click on a deleted link → no deleted row", () => {
    const result = stats({
      aggregates: [aDailyAggregate({ metric: "link_click", linkId: LINK_IDS[0], value: 1 })],
      links: [instagram],
    });

    expect(result.linkClicks).toStrictEqual([{ kind: "link", linkId: LINK_IDS[0], platform: "instagram", label: "Mes photos", clicks: 1 }]);
  });

  it("a link_click without link_id counts as a deleted link", () => {
    const result = stats({ aggregates: [aDailyAggregate({ metric: "link_click", linkId: null, value: 2 })] });

    expect(result.linkClicks).toStrictEqual([{ kind: "deleted", clicks: 2 }]);
    expect(result.totals.link_click).toBe(2);
  });

  it("clicks on a deleted link outside the range do not create the deleted row", () => {
    const result = stats({
      aggregates: [aDailyAggregate({ day: "2026-11-01", metric: "link_click", linkId: DELETED_LINK_ID, value: 2 })],
      links: [instagram],
    });

    expect(result.linkClicks).toStrictEqual([{ kind: "link", linkId: LINK_IDS[0], platform: "instagram", label: "Mes photos", clicks: 0 }]);
  });
});

describe("buildStats: empty state and purity (criterion 3)", () => {
  it("no aggregate → every bucket and every total at zero, links listed at zero, no deleted row", () => {
    const result = stats({ period: "12m", links: [aSavedLink({ id: LINK_IDS[0] })] });

    expect(result).toStrictEqual({
      period: "12m",
      range: { from: "2025-12-01", to: "2026-11-18" },
      buckets: statsBuckets("12m", STATS_TODAY).map((bucket) => ({ ...bucket, counts: ZERO })),
      totals: ZERO,
      viewsBySource: { nfc: 0, qr: 0, direct: 0 },
      linkClicks: [{ kind: "link", linkId: LINK_IDS[0], platform: "linkedin", label: null, clicks: 0 }],
      empty: true,
    });
  });

  it("same input twice → same output; the inputs are not mutated", () => {
    const aggregates = Object.freeze([
      Object.freeze(aDailyAggregate({ value: 2 })),
      Object.freeze(aDailyAggregate({ metric: "link_click", linkId: DELETED_LINK_ID, value: 1 })),
    ]);
    const links = Object.freeze([Object.freeze(aSavedLink({ id: LINK_IDS[0], position: 1 })), Object.freeze(aSavedLink({ id: LINK_IDS[1], position: 0 }))]);
    const input = { period: "7d" as const, today: STATS_TODAY, aggregates, links };

    const first = buildStats(input);
    const second = buildStats(input);

    expect(second).toStrictEqual(first);
    expect(links.map((link) => link.id)).toStrictEqual([LINK_IDS[0], LINK_IDS[1]]);
  });
});

describe("buildStats: empty (criterion 3, decision 8)", () => {
  it("no aggregate at all → empty", () => {
    expect(stats({ links: [aSavedLink({ id: LINK_IDS[0] })] }).empty).toBe(true);
  });

  it.each(STATS_METRICS.map((metric) => [metric]))("one %s in the range → not empty", (metric) => {
    const linkId = metric === "link_click" ? LINK_IDS[0] : null;

    expect(stats({ aggregates: [aDailyAggregate({ metric, linkId, value: 1 })], links: [aSavedLink({ id: LINK_IDS[0] })] }).empty).toBe(false);
  });

  it("only clicks on deleted links → not empty", () => {
    const result = stats({ aggregates: [aDailyAggregate({ metric: "link_click", linkId: DELETED_LINK_ID, value: 2 })] });

    expect(result.empty).toBe(false);
  });

  it("only clicks without link_id → not empty", () => {
    expect(stats({ aggregates: [aDailyAggregate({ metric: "link_click", linkId: null, value: 1 })] }).empty).toBe(false);
  });

  it("data outside the displayed period only → empty", () => {
    const result = stats({
      period: "7d",
      aggregates: [aDailyAggregate({ day: "2026-11-11", value: 5 }), aDailyAggregate({ day: "2026-11-19", value: 5 })],
    });

    expect(result.empty).toBe(true);
  });

  it("the same data is empty on 7 days and not empty on 30 days (period displayed)", () => {
    const aggregates = [aDailyAggregate({ day: "2026-11-01", value: 3 })];

    expect(stats({ period: "7d", aggregates }).empty).toBe(true);
    expect(stats({ period: "30d", aggregates }).empty).toBe(false);
  });

  it("only lead_submitted (not a metric shown) → empty", () => {
    expect(stats({ aggregates: [aDailyAggregate({ metric: "lead_submitted", value: 4 })] }).empty).toBe(true);
  });

  it("only rows at zero → empty", () => {
    expect(stats({ aggregates: [aDailyAggregate({ value: 0 }), aDailyAggregate({ metric: "nfc_scan", source: "nfc", value: 0 })] }).empty).toBe(true);
  });
});
