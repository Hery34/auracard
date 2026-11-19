import { Button } from "@/ui/primitives/button";

type Props = { canGoBack: boolean; canGoForward: boolean; onChange: (delta: -1 | 1) => void };

export function WeekNav({ canGoBack, canGoForward, onChange }: Props) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <Button type="button" variant="outline" disabled={!canGoBack} onClick={() => onChange(-1)}>
        Semaine précédente
      </Button>
      <Button type="button" variant="outline" disabled={!canGoForward} onClick={() => onChange(1)}>
        Semaine suivante
      </Button>
    </div>
  );
}
