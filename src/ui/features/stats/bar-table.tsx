import type { BarChartView } from "@/ui/features/stats/stats-view";

/** Visible table, one horizontal CSS bar per row beside the value. */
export function BarTable({ chart }: { chart: BarChartView }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{chart.caption}</h2>
      <table className="w-full border-separate border-spacing-y-2 text-left">
        <caption className="sr-only">{chart.caption}</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">{chart.labelHeader}</th>
            <th scope="col">Nombre</th>
          </tr>
        </thead>
        <tbody>
          {chart.rows.map((row) => (
            <tr key={row.key} className="bg-card text-card-foreground">
              <td className="rounded-l-lg p-3">
                <span className="block break-words">{row.label}</span>
                <span aria-hidden="true" className="mt-2 block h-2 rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${row.percent}%` }} />
                </span>
              </td>
              <td className="w-16 rounded-r-lg bg-card p-3 text-right font-semibold tabular-nums text-card-foreground">
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
