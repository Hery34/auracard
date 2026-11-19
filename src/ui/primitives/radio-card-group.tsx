import type { ReactNode } from "react";

import { cn } from "@/ui/lib/utils";

export type RadioCardOption = { value: string; label: ReactNode; description?: ReactNode };

type Props = {
  legend: string;
  /** Shared by the radios: the browser moves the choice with the arrow keys. */
  name: string;
  options: readonly RadioCardOption[];
  value: string | null;
  onChange: (value: string) => void;
  className?: string;
};

/** Native radios in visible labels (≥ 44 px), grouped by a fieldset and its legend. */
export function RadioCardGroup({ legend, name, options, value, onChange, className }: Props) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-base font-medium">{legend}</legend>
      <div className={cn("grid gap-2", className)}>
        {options.map((option) => (
          <label
            key={option.value}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-input px-3 py-2 text-foreground has-checked:border-primary has-checked:bg-muted has-focus-visible:ring-3 has-focus-visible:ring-ring"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="size-5 shrink-0 cursor-pointer accent-primary outline-none"
            />
            <span className="flex min-w-0 flex-col">
              <span>{option.label}</span>
              {option.description !== undefined && <span className="text-sm text-muted-foreground">{option.description}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
