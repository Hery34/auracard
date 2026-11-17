import { NO_TAGS_MESSAGE } from "@/ui/features/nfc/messages";
import { ReleaseTagDialog } from "@/ui/features/nfc/release-tag-dialog";
import { ToggleTagForm } from "@/ui/features/nfc/toggle-tag-form";
import type { NfcTagRow } from "@/ui/features/nfc/tag-row";

/** One list item per tag: abbreviated id, status, activation date, then its actions. */
export function NfcTagList({ rows }: { rows: readonly NfcTagRow[] }) {
  if (rows.length === 0) {
    return <p>{NO_TAGS_MESSAGE}</p>;
  }
  return (
    <ul className="flex flex-col gap-4">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground">
          <div className="flex flex-col gap-1">
            <p className="text-lg font-medium">Carte …{row.shortId}</p>
            <p>
              <span className="text-muted-foreground">Statut : </span>
              <span className={row.enabled ? "font-medium text-link" : "font-medium"}>{row.statusLabel}</span>
            </p>
            {row.activatedOn !== null && (
              <p>
                <span className="text-muted-foreground">Activée le </span>
                {row.activatedOn}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <ToggleTagForm row={row} />
            <ReleaseTagDialog row={row} />
          </div>
        </li>
      ))}
    </ul>
  );
}
