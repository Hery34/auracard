/**
 * Contract frozen by test-engineer (0030, decision 8): view model of `/tableau-de-bord/statistiques`.
 *
 * // src/ui/features/stats/stats-view.ts — existing exports kept:
 * export function periodFromSearchParam(value: string | string[] | undefined): StatsPeriod; // fallback 30d
 * export function periodOptions(active: StatsPeriod): PeriodOption[];
 * export function toStatsView(stats: Stats): StatsView;
 * export const STATS_PATH, STATS_NOTICE, STATS_EMPTY_MESSAGE, DELETED_LINK_LABEL;
 *
 * // New or changed (decision 8):
 * export type SeriesChartView = BarChartView & {
 *   firstLabel: string; // label of the first interval, shown under the bars
 *   lastLabel: string;  // label of the last interval, shown under the bars
 * };
 * export type SeriesTableView = {
 *   caption: string;     // contains « par jour » (7d, 30d), « par semaine » (12w) or « par mois » (12m); it is the only
 *                        // table of the page whose name contains one of these (the bar chart has no table of its own)
 *   labelHeader: string; // « Période »
 *   columns: Array<{ key: StatsMetric; label: string }>; // STATS_METRICS order, labels of the cards
 *   rows: Array<{ key: string; label: string; values: string[] }>; // one per bucket, values in column order, fr-FR
 * };
 * export type StatsView = {
 *   empty: boolean;              // stats.empty (domain rule), never recomputed here
 *   cards: StatCard[];
 *   series: SeriesChartView;     // bars of profile_view per bucket
 *   seriesTable: SeriesTableView;
 *   sources: BarChartView;       // ANALYTICS_SOURCES order
 *   links: BarChartView;
 * };
 * Interval labels (fr-FR, calendar day without time zone): day « 18 nov. », week « Semaine du 16 nov. »,
 * month « novembre 2026 ». Bar `percent` = round(value / max × 100), 0 for every row when max is 0.
 */
import { describe, expect, it } from "vitest";

import { ANALYTICS_SOURCES } from "@/domain/analytics/analytics-event";
import { buildStats, DEFAULT_STATS_PERIOD, STATS_METRICS, type DailyAggregate, type Stats, type StatsPeriod } from "@/domain/analytics/stats";
import type { SavedLink } from "@/domain/profile/link";
import { DELETED_LINK_LABEL, periodFromSearchParam, periodOptions, STATS_PATH, toStatsView } from "@/ui/features/stats/stats-view";

import { aSavedLink, LINK_IDS } from "../../../../tests/builders/links";
import { aDailyAggregate, DELETED_LINK_ID, STATS_TODAY } from "../../../../tests/builders/stats";

function stats(input: { period?: StatsPeriod; aggregates?: DailyAggregate[]; links?: SavedLink[] } = {}): Stats {
  return buildStats({
    period: input.period ?? "7d",
    today: STATS_TODAY,
    aggregates: input.aggregates ?? [],
    links: input.links ?? [],
  });
}

function view(input: Parameters<typeof stats>[0] = {}) {
  return toStatsView(stats(input));
}

describe("periodFromSearchParam: fallback of ?periode= (decision 7)", () => {
  it.each(["7d", "30d", "12w", "12m"] as const)("%j → %j", (value) => {
    expect(periodFromSearchParam(value)).toBe(value);
  });

  it("absent → 30 days", () => {
    expect(periodFromSearchParam(undefined)).toBe(DEFAULT_STATS_PERIOD);
    expect(DEFAULT_STATS_PERIOD).toBe("30d");
  });

  it.each([[["7d"]], [["7d", "12m"]], [["12m", "12m"]], [[]]])("repeated %j → 30 days", (value) => {
    expect(periodFromSearchParam(value)).toBe("30d");
  });

  it.each(["", "7D", "1y", " 7d", "constructor", "__proto__"])("invalid %j → 30 days", (value) => {
    expect(periodFromSearchParam(value)).toBe("30d");
  });
});

describe("periodOptions", () => {
  it("four options in order, one link each, the active one marked", () => {
    expect(periodOptions("12w")).toStrictEqual([
      { period: "7d", label: "7 jours", href: `${STATS_PATH}?periode=7d`, active: false },
      { period: "30d", label: "30 jours", href: `${STATS_PATH}?periode=30d`, active: false },
      { period: "12w", label: "12 semaines", href: `${STATS_PATH}?periode=12w`, active: true },
      { period: "12m", label: "12 mois", href: `${STATS_PATH}?periode=12m`, active: false },
    ]);
  });
});

describe("toStatsView: empty comes from the domain (decision 8)", () => {
  it("stats.empty true → view empty", () => {
    expect(view().empty).toBe(true);
  });

  it("stats.empty false → view not empty, even with only deleted-link clicks", () => {
    expect(view({ aggregates: [aDailyAggregate({ metric: "link_click", linkId: DELETED_LINK_ID, value: 1 })] }).empty).toBe(false);
  });

  it("the view does not recompute it from the totals", () => {
    const zero = stats();
    const withData = stats({ aggregates: [aDailyAggregate({ value: 3 })] });

    expect(toStatsView({ ...zero, empty: false }).empty).toBe(false);
    expect(toStatsView({ ...withData, empty: true }).empty).toBe(true);
  });
});

describe("toStatsView: interval labels (decision 2)", () => {
  it("7 days: one label per day, « 12 nov. » … « 18 nov. »", () => {
    expect(view({ period: "7d" }).series.rows.map((row) => row.label)).toStrictEqual([
      "12 nov.",
      "13 nov.",
      "14 nov.",
      "15 nov.",
      "16 nov.",
      "17 nov.",
      "18 nov.",
    ]);
  });

  it("30 days: from « 20 oct. » to « 18 nov. »", () => {
    const rows = view({ period: "30d" }).series.rows;

    expect(rows).toHaveLength(30);
    expect(rows[0]?.label).toBe("20 oct.");
    expect(rows.at(-1)?.label).toBe("18 nov.");
  });

  it("12 weeks: « Semaine du <lundi> »", () => {
    const rows = view({ period: "12w" }).series.rows;

    expect(rows).toHaveLength(12);
    expect(rows[0]?.label).toBe("Semaine du 31 août");
    expect(rows.at(-1)?.label).toBe("Semaine du 16 nov.");
  });

  it("12 months: month and year", () => {
    const rows = view({ period: "12m" }).series.rows;

    expect(rows).toHaveLength(12);
    expect(rows[0]?.label).toBe("décembre 2025");
    expect(rows[1]?.label).toBe("janvier 2026");
    expect(rows.at(-1)?.label).toBe("novembre 2026");
  });

  it.each([
    ["7d", "12 nov.", "18 nov."],
    ["30d", "20 oct.", "18 nov."],
    ["12w", "Semaine du 31 août", "Semaine du 16 nov."],
    ["12m", "décembre 2025", "novembre 2026"],
  ] as const)("%s: first and last interval labels shown under the bars: %j, %j", (period, first, last) => {
    const { series } = view({ period });

    expect(series.firstLabel).toBe(first);
    expect(series.lastLabel).toBe(last);
    expect(series.firstLabel).toBe(series.rows[0]?.label);
    expect(series.lastLabel).toBe(series.rows.at(-1)?.label);
  });

  it("the bars of the series are the views per interval", () => {
    const { series } = view({ aggregates: [aDailyAggregate({ day: "2026-11-16", value: 4 }), aDailyAggregate({ metric: "nfc_scan", source: "nfc", value: 9 })] });

    expect(series.rows.map((row) => row.value)).toStrictEqual(["0", "0", "0", "0", "4", "0", "0"]);
  });
});

describe("toStatsView: bar percent", () => {
  it("max 0 → every bar at 0 (no division by zero)", () => {
    const result = view({ links: [aSavedLink({ id: LINK_IDS[0] })] });

    expect(result.sources.rows.map((row) => row.percent)).toStrictEqual([0, 0, 0]);
    expect(result.series.rows.every((row) => row.percent === 0)).toBe(true);
    expect(result.links.rows.map((row) => row.percent)).toStrictEqual([0]);
  });

  it("relative to the largest value, rounded to the nearest integer", () => {
    const result = view({
      aggregates: [aDailyAggregate({ source: "nfc", value: 3 }), aDailyAggregate({ source: "qr", value: 2 }), aDailyAggregate({ source: "direct", value: 1 })],
    });

    expect(result.sources.rows.map((row) => row.percent)).toStrictEqual([100, 67, 33]);
  });

  it("half rounds up: 1 of 8 → 13", () => {
    const result = view({ aggregates: [aDailyAggregate({ source: "nfc", value: 8 }), aDailyAggregate({ source: "qr", value: 1 })] });

    expect(result.sources.rows.map((row) => row.percent)).toStrictEqual([100, 13, 0]);
  });

  it("values are formatted in fr-FR", () => {
    const result = view({ aggregates: [aDailyAggregate({ source: "nfc", value: 1234 })] });

    expect(result.sources.rows[0]?.value).toBe(new Intl.NumberFormat("fr-FR").format(1234));
  });
});

describe("toStatsView: sources", () => {
  it("one row per source in ANALYTICS_SOURCES order", () => {
    expect(view().sources.rows.map((row) => [row.key, row.label])).toStrictEqual([
      ["nfc", "NFC"],
      ["qr", "QR"],
      ["direct", "Direct"],
    ]);
    expect(view().sources.rows.map((row) => row.key)).toStrictEqual([...ANALYTICS_SOURCES]);
  });
});

describe("toStatsView: link labels (decision 3)", () => {
  it("current label, else the platform name; « Lien supprimé » last", () => {
    const result = view({
      aggregates: [
        aDailyAggregate({ metric: "link_click", linkId: LINK_IDS[0], value: 4 }),
        aDailyAggregate({ metric: "link_click", linkId: DELETED_LINK_ID, value: 2 }),
      ],
      links: [
        aSavedLink({ id: LINK_IDS[0], platform: "instagram", url: "https://www.instagram.com/elodie/", label: "Mes photos", position: 0 }),
        aSavedLink({ id: LINK_IDS[1], platform: "linkedin", label: null, position: 1 }),
      ],
    });

    expect(result.links.rows.map((row) => [row.key, row.label, row.value])).toStrictEqual([
      [LINK_IDS[0], "Mes photos", "4"],
      [LINK_IDS[1], "LinkedIn", "0"],
      ["deleted", DELETED_LINK_LABEL, "2"],
    ]);
    expect(DELETED_LINK_LABEL).toBe("Lien supprimé");
  });
});

describe("toStatsView: cards and series table (decision 8)", () => {
  const CARD_LABELS = [
    "Scans NFC",
    "Scans QR",
    "Vues",
    "Téléchargements vCard",
    "Clics sur les liens",
    "Clics contact (téléphone, e-mail, site web)",
  ];

  it("six cards in STATS_METRICS order", () => {
    expect(view().cards.map((card) => card.key)).toStrictEqual([...STATS_METRICS]);
    expect(view().cards.map((card) => card.label)).toStrictEqual(CARD_LABELS);
  });

  it.each([
    ["7d", /par jour/],
    ["30d", /par jour/],
    ["12w", /par semaine/],
    ["12m", /par mois/],
  ] as const)("%s: caption matches %s", (period, caption) => {
    expect(view({ period }).seriesTable.caption).toMatch(caption);
  });

  it("one column per metric, in STATS_METRICS order, with the labels of the cards", () => {
    const { seriesTable, cards } = view();

    expect(seriesTable.labelHeader).toBe("Période");
    expect(seriesTable.columns.map((column) => column.key)).toStrictEqual([...STATS_METRICS]);
    expect(seriesTable.columns.map((column) => column.label)).toStrictEqual(cards.map((card) => card.label));
  });

  it("one row per interval with the interval label and every metric in column order", () => {
    const { seriesTable, series } = view({
      aggregates: [
        aDailyAggregate({ day: "2026-11-16", metric: "nfc_scan", source: "nfc", value: 3 }),
        aDailyAggregate({ day: "2026-11-16", metric: "qr_scan", source: "qr", value: 2 }),
        aDailyAggregate({ day: "2026-11-16", source: "direct", value: 10 }),
        aDailyAggregate({ day: "2026-11-16", metric: "vcard_download", value: 1 }),
        aDailyAggregate({ day: "2026-11-16", metric: "link_click", linkId: DELETED_LINK_ID, value: 6 }),
        aDailyAggregate({ day: "2026-11-16", metric: "contact_click", value: 1234 }),
        aDailyAggregate({ day: "2026-11-16", metric: "lead_submitted", value: 99 }),
      ],
    });

    expect(seriesTable.rows).toHaveLength(7);
    expect(seriesTable.rows.map((row) => row.label)).toStrictEqual(series.rows.map((row) => row.label));
    expect(seriesTable.rows.map((row) => row.key)).toStrictEqual(series.rows.map((row) => row.key));
    expect(seriesTable.rows[4]?.values).toStrictEqual(["3", "2", "10", "1", "6", new Intl.NumberFormat("fr-FR").format(1234)]);
    expect(seriesTable.rows[0]?.values).toStrictEqual(["0", "0", "0", "0", "0", "0"]);
  });

  it("12 months: one row per month", () => {
    const { seriesTable } = view({ period: "12m", aggregates: [aDailyAggregate({ day: "2025-12-15", metric: "qr_scan", source: "qr", value: 5 })] });

    expect(seriesTable.rows).toHaveLength(12);
    expect(seriesTable.rows[0]).toMatchObject({ label: "décembre 2025", values: ["0", "5", "0", "0", "0", "0"] });
  });
});
