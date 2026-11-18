import type { SeriesChartView } from "@/ui/features/stats/stats-view";

/** CSS bars hidden from assistive technologies; the series table carries the same data (0030, decisions 1 and 8). */
export function BarChart({ chart }: { chart: SeriesChartView }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{chart.caption}</h2>
      <div aria-hidden="true" className="flex flex-col gap-1">
        <div className="flex h-32 items-end gap-px rounded-lg border border-border bg-card p-2">
          {chart.rows.map((row) => (
            <div key={row.key} className="flex h-full flex-1 items-end">
              <div className="w-full rounded-t-sm bg-primary" style={{ height: `${row.percent}%` }} />
            </div>
          ))}
        </div>
        <div className="flex justify-between gap-2 text-sm text-muted-foreground">
          <span>{chart.firstLabel}</span>
          <span className="text-right">{chart.lastLabel}</span>
        </div>
      </div>
    </section>
  );
}
