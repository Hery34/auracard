import { ANALYTICS_SOURCES, type AnalyticsSource } from "@/domain/analytics/analytics-event";
import {
  DEFAULT_STATS_PERIOD,
  parseStatsPeriod,
  STATS_METRICS,
  STATS_PERIODS,
  type LinkClickRow,
  type Stats,
  type StatsBucket,
  type StatsMetric,
  type StatsPeriod,
} from "@/domain/analytics/stats";
import { PLATFORM_NAMES } from "@/ui/features/profile/platform-names";

export const STATS_PATH = "/tableau-de-bord/statistiques";
export const STATS_NOTICE = "Mis à jour toutes les 15 minutes. Robots et aperçus de liens exclus.";
export const STATS_EMPTY_MESSAGE = "Aucune donnée sur cette période.";
export const DELETED_LINK_LABEL = "Lien supprimé";

const PERIOD_LABELS: Readonly<Record<StatsPeriod, string>> = {
  "7d": "7 jours",
  "30d": "30 jours",
  "12w": "12 semaines",
  "12m": "12 mois",
};

const METRIC_LABELS: Readonly<Record<StatsMetric, string>> = {
  nfc_scan: "Scans NFC",
  qr_scan: "Scans QR",
  profile_view: "Vues",
  vcard_download: "Téléchargements vCard",
  link_click: "Clics sur les liens",
  contact_click: "Clics contact (téléphone, e-mail, site web)",
};

const SOURCE_LABELS: Readonly<Record<AnalyticsSource, string>> = { nfc: "NFC", qr: "QR", direct: "Direct" };

const SERIES_CAPTIONS: Readonly<Record<StatsPeriod, string>> = {
  "7d": "Vues par jour",
  "30d": "Vues par jour",
  "12w": "Vues par semaine",
  "12m": "Vues par mois",
};

const SERIES_TABLE_CAPTIONS: Readonly<Record<StatsPeriod, string>> = {
  "7d": "Activité par jour",
  "30d": "Activité par jour",
  "12w": "Activité par semaine",
  "12m": "Activité par mois",
};

const INTERVAL_HEADER = "Période";

const NUMBER = new Intl.NumberFormat("fr-FR");
const DAY = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "short" });
const MONTH = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", month: "long", year: "numeric" });

export type PeriodOption = { period: StatsPeriod; label: string; href: string; active: boolean };
export type StatCard = { key: StatsMetric; label: string; value: string };
export type BarRow = { key: string; label: string; value: string; percent: number };
export type BarChartView = { caption: string; labelHeader: string; rows: BarRow[] };
export type SeriesChartView = BarChartView & { firstLabel: string; lastLabel: string };
export type SeriesTableView = {
  caption: string;
  labelHeader: string;
  columns: Array<{ key: StatsMetric; label: string }>;
  rows: Array<{ key: string; label: string; values: string[] }>;
};

export type StatsView = {
  empty: boolean;
  cards: StatCard[];
  series: SeriesChartView;
  seriesTable: SeriesTableView;
  sources: BarChartView;
  links: BarChartView;
};

/** Missing, repeated or unknown `?periode=` falls back to the default period. */
export function periodFromSearchParam(value: string | string[] | undefined): StatsPeriod {
  if (typeof value !== "string") {
    return DEFAULT_STATS_PERIOD;
  }
  const parsed = parseStatsPeriod(value);
  return parsed.ok ? parsed.value : DEFAULT_STATS_PERIOD;
}

export function periodOptions(active: StatsPeriod): PeriodOption[] {
  return STATS_PERIODS.map((period) => ({
    period,
    label: PERIOD_LABELS[period],
    href: `${STATS_PATH}?periode=${period}`,
    active: period === active,
  }));
}

function toDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function bucketLabel(period: StatsPeriod, bucket: StatsBucket): string {
  switch (period) {
    case "7d":
    case "30d":
      return DAY.format(toDate(bucket.from));
    case "12w":
      return `Semaine du ${DAY.format(toDate(bucket.from))}`;
    case "12m":
      return MONTH.format(toDate(bucket.from));
  }
}

function linkLabel(row: LinkClickRow): string {
  return row.kind === "deleted" ? DELETED_LINK_LABEL : (row.label ?? PLATFORM_NAMES[row.platform]);
}

function toBars(entries: ReadonlyArray<{ key: string; label: string; value: number }>): BarRow[] {
  const max = Math.max(0, ...entries.map((entry) => entry.value));
  return entries.map(({ key, label, value }) => ({
    key,
    label,
    value: NUMBER.format(value),
    percent: max === 0 ? 0 : Math.round((value / max) * 100),
  }));
}

function toSeriesChart(stats: Stats): SeriesChartView {
  const rows = toBars(
    stats.buckets.map((bucket) => ({
      key: bucket.from,
      label: bucketLabel(stats.period, bucket),
      value: bucket.counts.profile_view,
    })),
  );
  return {
    caption: SERIES_CAPTIONS[stats.period],
    labelHeader: INTERVAL_HEADER,
    rows,
    firstLabel: rows[0]?.label ?? "",
    lastLabel: rows.at(-1)?.label ?? "",
  };
}

function toSeriesTable(stats: Stats): SeriesTableView {
  return {
    caption: SERIES_TABLE_CAPTIONS[stats.period],
    labelHeader: INTERVAL_HEADER,
    columns: STATS_METRICS.map((metric) => ({ key: metric, label: METRIC_LABELS[metric] })),
    rows: stats.buckets.map((bucket) => ({
      key: bucket.from,
      label: bucketLabel(stats.period, bucket),
      values: STATS_METRICS.map((metric) => NUMBER.format(bucket.counts[metric])),
    })),
  };
}

export function toStatsView(stats: Stats): StatsView {
  return {
    empty: stats.empty,
    cards: STATS_METRICS.map((metric) => ({ key: metric, label: METRIC_LABELS[metric], value: NUMBER.format(stats.totals[metric]) })),
    series: toSeriesChart(stats),
    seriesTable: toSeriesTable(stats),
    sources: {
      caption: "Vues par source",
      labelHeader: "Source",
      rows: toBars(ANALYTICS_SOURCES.map((source) => ({ key: source, label: SOURCE_LABELS[source], value: stats.viewsBySource[source] }))),
    },
    links: {
      caption: "Clics par lien",
      labelHeader: "Lien",
      rows: toBars(
        stats.linkClicks.map((row) => ({
          key: row.kind === "deleted" ? "deleted" : row.linkId,
          label: linkLabel(row),
          value: row.clicks,
        })),
      ),
    },
  };
}
