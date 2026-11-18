import Link from "next/link";

import type { PeriodOption } from "@/ui/features/stats/stats-view";
import { cn } from "@/ui/lib/utils";

export function PeriodNav({ options }: { options: readonly PeriodOption[] }) {
  return (
    <nav aria-label="Période">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {options.map((option) => (
          <li key={option.period}>
            <Link
              href={option.href}
              aria-current={option.active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center justify-center rounded-lg border px-3 text-sm font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                option.active ? "border-2 border-primary bg-card" : "border-border bg-background hover:bg-muted",
              )}
            >
              {option.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
