import { DeleteLeadDialog } from "@/ui/features/lead/delete-lead-dialog";
import type { LeadItem } from "@/ui/features/lead/lead-item";
import { NO_LEADS_MESSAGE } from "@/ui/features/lead/messages";

/** Visitors' messages, newest first; every text is rendered as plain text (decision 11). */
export function LeadList({ items }: { items: readonly LeadItem[] }) {
  if (items.length === 0) {
    return <p>{NO_LEADS_MESSAGE}</p>;
  }
  return (
    <ul className="flex flex-col gap-4">
      {items.map((item) => (
        <li key={item.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-medium break-words">{item.name}</h2>
            <p className="break-all">{item.email}</p>
            {item.receivedOn !== null && (
              <p className="text-sm text-muted-foreground">
                Reçu le <time dateTime={item.createdAt}>{item.receivedOn}</time>
              </p>
            )}
          </div>
          <p className="whitespace-pre-wrap break-words">{item.message}</p>
          <DeleteLeadDialog leadId={item.id} senderName={item.name} />
        </li>
      ))}
    </ul>
  );
}
