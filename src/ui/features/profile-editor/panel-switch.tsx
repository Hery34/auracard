import { Button } from "@/ui/primitives/button";

export type Panel = "edit" | "preview";

const PANELS: readonly { panel: Panel; label: string }[] = [
  { panel: "edit", label: "Modifier" },
  { panel: "preview", label: "Aperçu" },
];

/** Small screens only: one panel at a time; both are shown side by side from `lg`. */
export function PanelSwitch({ active, onChange }: { active: Panel; onChange: (panel: Panel) => void }) {
  return (
    <div role="group" aria-label="Affichage" className="flex gap-2 lg:hidden">
      {PANELS.map(({ panel, label }) => (
        <Button
          key={panel}
          type="button"
          variant={active === panel ? "default" : "outline"}
          aria-pressed={active === panel}
          onClick={() => onChange(panel)}
          className="flex-1"
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
