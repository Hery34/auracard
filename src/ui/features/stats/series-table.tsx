import type { SeriesTableView } from "@/ui/features/stats/stats-view";

/** Every metric per interval; open by default so it is visible without interaction, foldable on small screens (0030, decision 8). */
export function SeriesTable({ table }: { table: SeriesTableView }) {
  return (
    <details open>
      <summary className="flex min-h-11 cursor-pointer items-center rounded-lg text-lg font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
        {table.caption}
      </summary>
      <div role="region" aria-label={table.caption} tabIndex={0} className="mt-3 overflow-x-auto rounded-lg border border-border bg-card text-card-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{table.caption}</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="p-2 align-bottom font-semibold">
                {table.labelHeader}
              </th>
              {table.columns.map((column) => (
                <th key={column.key} scope="col" className="min-w-20 p-2 text-right align-bottom font-semibold">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.key} className="border-b border-border last:border-b-0">
                <th scope="row" className="whitespace-nowrap p-2 font-normal">
                  {row.label}
                </th>
                {row.values.map((value, index) => (
                  <td key={table.columns[index]?.key ?? index} className="p-2 text-right tabular-nums">
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
