import {
  ANALYTICS_SOURCES,
  includes,
  type AnalyticsEventType,
  type AnalyticsSource,
} from "@/domain/analytics/analytics-event";
import type { LinkPlatform, SavedLink } from "@/domain/profile/link";
import { err, ok, type Result } from "@/domain/shared/result";

export const STATS_PERIODS = ["7d", "30d", "12w", "12m"] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];
export const DEFAULT_STATS_PERIOD: StatsPeriod = "30d";

/** The six metrics shown (0030, decision 6): `lead_submitted` is not one of them. */
export const STATS_METRICS = [
  "nfc_scan",
  "qr_scan",
  "profile_view",
  "vcard_download",
  "link_click",
  "contact_click",
] as const satisfies readonly AnalyticsEventType[];
export type StatsMetric = (typeof STATS_METRICS)[number];
export type MetricCounts = Readonly<Record<StatsMetric, number>>;

/** Calendar days of Europe/Paris as "YYYY-MM-DD", inclusive at both ends. */
export type DayRange = { from: string; to: string };

/** One row of `carnet.analytics_daily`. */
export type DailyAggregate = {
  day: string;
  metric: AnalyticsEventType;
  linkId: string | null;
  source: AnalyticsSource | null;
  value: number;
};

export type StatsBucket = DayRange & { counts: MetricCounts };

export type LinkClickRow =
  | { kind: "link"; linkId: string; platform: LinkPlatform; label: string | null; clicks: number }
  | { kind: "deleted"; clicks: number };

export type Stats = {
  period: StatsPeriod;
  range: DayRange;
  buckets: StatsBucket[];
  totals: MetricCounts;
  viewsBySource: Readonly<Record<AnalyticsSource, number>>;
  linkClicks: LinkClickRow[];
  /** Every total of `STATS_METRICS` is 0 over the range. */
  empty: boolean;
};

export function parseStatsPeriod(value: string): Result<StatsPeriod, "invalid_period"> {
  const period = STATS_PERIODS.find((candidate) => candidate === value);
  return period === undefined ? err("invalid_period") : ok(period);
}

const PARIS_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function parisDay(instant: Date): string {
  const parts = PARIS_DAY.formatToParts(instant);
  const part = (type: "year" | "month" | "day") => parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Calendar arithmetic on "YYYY-MM-DD" through UTC dates: no time zone, no daylight saving. */
function toDate(day: string): Date {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date));
}

function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  const date = toDate(day);
  date.setUTCDate(date.getUTCDate() + days);
  return toDay(date);
}

function earliest(a: string, b: string): string {
  return a < b ? a : b;
}

function dailyBuckets(count: number, today: string): DayRange[] {
  return Array.from({ length: count }, (_, index) => {
    const day = addDays(today, index - count + 1);
    return { from: day, to: day };
  });
}

/** ISO weeks, Monday to Sunday. */
function weeklyBuckets(count: number, today: string): DayRange[] {
  const daysSinceMonday = (toDate(today).getUTCDay() + 6) % 7;
  const currentMonday = addDays(today, -daysSinceMonday);
  return Array.from({ length: count }, (_, index) => {
    const from = addDays(currentMonday, (index - count + 1) * 7);
    return { from, to: earliest(addDays(from, 6), today) };
  });
}

function monthlyBuckets(count: number, today: string): DayRange[] {
  const current = toDate(today);
  return Array.from({ length: count }, (_, index) => {
    const offset = index - count + 1;
    const first = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + offset, 1));
    const last = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + offset + 1, 0));
    return { from: toDay(first), to: earliest(toDay(last), today) };
  });
}

/** Oldest first, contiguous, the last one ends today. */
export function statsBuckets(period: StatsPeriod, today: string): DayRange[] {
  switch (period) {
    case "7d":
      return dailyBuckets(7, today);
    case "30d":
      return dailyBuckets(30, today);
    case "12w":
      return weeklyBuckets(12, today);
    case "12m":
      return monthlyBuckets(12, today);
  }
}

export function statsRange(period: StatsPeriod, today: string): DayRange {
  const [first] = statsBuckets(period, today);
  return { from: first?.from ?? today, to: today };
}

function isStatsMetric(metric: AnalyticsEventType): metric is StatsMetric {
  return includes(STATS_METRICS, metric);
}

function zeroCounts(): Record<StatsMetric, number> {
  return Object.fromEntries(STATS_METRICS.map((metric) => [metric, 0])) as Record<StatsMetric, number>;
}

/** Current links by position (zero included), then one "deleted" row, only when > 0. */
function linkClickRows(
  links: readonly SavedLink[],
  clicksByLink: ReadonlyMap<string, number>,
  deletedClicks: number,
): LinkClickRow[] {
  const rows: LinkClickRow[] = links.map(({ id, platform, label }) => ({
    kind: "link",
    linkId: id,
    platform,
    label,
    clicks: clicksByLink.get(id) ?? 0,
  }));
  if (deletedClicks > 0) {
    rows.push({ kind: "deleted", clicks: deletedClicks });
  }
  return rows;
}

/**
 * Every bucket of the period (zero when no data), totals over the range, views by source, then clicks per current
 * link by position (zero included) and one "deleted" row, last and only when > 0, for every other `link_id`.
 * Aggregates outside the range and metrics not shown are ignored.
 */
export function buildStats(input: {
  period: StatsPeriod;
  today: string;
  aggregates: readonly DailyAggregate[];
  links: readonly SavedLink[];
}): Stats {
  const { period, today } = input;
  const ranges = statsBuckets(period, today);
  const range = statsRange(period, today);
  const bucketCounts = ranges.map(() => zeroCounts());
  const totals = zeroCounts();
  const viewsBySource = Object.fromEntries(ANALYTICS_SOURCES.map((source) => [source, 0])) as Record<AnalyticsSource, number>;
  const links = [...input.links].sort((a, b) => a.position - b.position);
  const clicksByLink = new Map(links.map((link) => [link.id, 0]));
  let deletedClicks = 0;

  for (const { day, metric, linkId, source, value } of input.aggregates) {
    if (!isStatsMetric(metric) || day < range.from || day > range.to) {
      continue;
    }
    const counts = bucketCounts[ranges.findIndex((bucket) => day >= bucket.from && day <= bucket.to)];
    if (counts === undefined) {
      continue;
    }
    counts[metric] += value;
    totals[metric] += value;
    if (metric === "profile_view" && source !== null) {
      viewsBySource[source] += value;
    }
    if (metric === "link_click") {
      const current = linkId === null ? undefined : clicksByLink.get(linkId);
      if (linkId !== null && current !== undefined) {
        clicksByLink.set(linkId, current + value);
      } else {
        deletedClicks += value;
      }
    }
  }

  return {
    period,
    range,
    buckets: ranges.map((bucket, index) => ({ ...bucket, counts: bucketCounts[index] ?? zeroCounts() })),
    totals,
    viewsBySource,
    linkClicks: linkClickRows(links, clicksByLink, deletedClicks),
    empty: STATS_METRICS.every((metric) => totals[metric] === 0),
  };
}
