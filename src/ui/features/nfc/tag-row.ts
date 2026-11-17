import { nfcTagShortId, type OwnNfcTag } from "@/domain/nfc/nfc-tag";

export type NfcTagRow = {
  id: string;
  shortId: string;
  statusLabel: "Active" | "Désactivée";
  activatedOn: string | null;
  enabled: boolean;
  toggleLabel: "Désactiver" | "Réactiver";
};

const ACTIVATION_DATE = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Paris",
});

function formatActivationDate(isoDate: string | null): string | null {
  if (isoDate === null) {
    return null;
  }
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? null : ACTIVATION_DATE.format(date);
}

export function toNfcTagRow(tag: OwnNfcTag): NfcTagRow {
  const enabled = tag.status === "assigned";
  return {
    id: tag.id,
    shortId: nfcTagShortId(tag.uid),
    statusLabel: enabled ? "Active" : "Désactivée",
    activatedOn: formatActivationDate(tag.activatedAt),
    enabled,
    toggleLabel: enabled ? "Désactiver" : "Réactiver",
  };
}
