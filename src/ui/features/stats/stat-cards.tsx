import type { StatCard } from "@/ui/features/stats/stats-view";

export function StatCards({ cards }: { cards: readonly StatCard[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3">
      {cards.map((card) => (
        <li key={card.key}>
          <div
            role="group"
            aria-labelledby={`stat-${card.key}`}
            className="flex h-full flex-col justify-between gap-2 rounded-lg border border-border bg-card p-4 text-card-foreground"
          >
            <p id={`stat-${card.key}`} className="text-sm text-muted-foreground">
              {card.label}
            </p>
            <p className="text-2xl font-semibold tabular-nums">{card.value}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
