import type { OwnLead } from "@/domain/lead/lead";

export type LeadItem = OwnLead & { receivedOn: string | null };

const RECEIVED_DATE = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});

function formatReceivedDate(createdAt: string): string | null {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? null : RECEIVED_DATE.format(date);
}

export function toLeadItem(lead: OwnLead): LeadItem {
  return { ...lead, receivedOn: formatReceivedDate(lead.createdAt) };
}

export function olderLeadsHref(older: string | null): string | null {
  return older === null ? null : `/tableau-de-bord/messages?avant=${older}`;
}
