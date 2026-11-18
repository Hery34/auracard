import type { StatsView } from "@/ui/features/stats/stats-view";
import { STATS_EMPTY_MESSAGE } from "@/ui/features/stats/stats-view";
import { BarChart } from "@/ui/features/stats/bar-chart";
import { BarTable } from "@/ui/features/stats/bar-table";
import { SeriesTable } from "@/ui/features/stats/series-table";
import { StatCards } from "@/ui/features/stats/stat-cards";

export function StatsReport({ view }: { view: StatsView }) {
  if (view.empty) {
    return <p>{STATS_EMPTY_MESSAGE}</p>;
  }
  return (
    <>
      <StatCards cards={view.cards} />
      <BarChart chart={view.series} />
      <SeriesTable table={view.seriesTable} />
      <BarTable chart={view.sources} />
      <BarTable chart={view.links} />
    </>
  );
}
