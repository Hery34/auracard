import { DeleteEventTypeDialog } from "@/ui/features/booking/delete-event-type-dialog";
import { EventTypeEditor } from "@/ui/features/booking/event-type-editor";
import type { EventTypeRow } from "@/ui/features/booking/event-type-row";
import { NO_EVENT_TYPES_MESSAGE } from "@/ui/features/booking/messages";
import { MoveEventTypeForm } from "@/ui/features/booking/move-event-type-form";
import { ToggleEventTypeForm } from "@/ui/features/booking/toggle-event-type-form";

/** One list item per type, in the order of the public page, then its actions. */
export function EventTypeList({ rows }: { rows: readonly EventTypeRow[] }) {
  if (rows.length === 0) {
    return <p>{NO_EVENT_TYPES_MESSAGE}</p>;
  }
  return (
    <ul className="flex flex-col gap-4">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-lg font-medium break-words">{row.title}</p>
            <p>
              {row.durationLabel}
              <span className="text-muted-foreground"> · </span>
              <span className={row.isActive ? "font-medium text-link" : "font-medium"}>{row.statusLabel}</span>
            </p>
            <p className="break-words">{row.locationLabel}</p>
            <p className="text-muted-foreground">{row.detailsLabel}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
            <EventTypeEditor row={row} />
            <ToggleEventTypeForm row={row} />
            <MoveEventTypeForm row={row} />
            <DeleteEventTypeDialog row={row} />
          </div>
        </li>
      ))}
    </ul>
  );
}
