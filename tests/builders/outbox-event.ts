/** Version 4 UUIDs of `carnet.outbox` events (the `id` that the e-mail's Message-ID is derived from). */
export const OUTBOX_EVENT_IDS = [
  "7f3e2d1c-4b5a-4c6d-9e8f-0a1b2c3d4e51",
  "8a4f3e2d-5c6b-4d7e-8f90-1b2c3d4e5f62",
] as const;

/** A row returned by `carnet.claim_outbox(p_limit)` for a `lead.created` event (migration 20261118120000). */
export type ClaimedOutboxEvent = {
  id: string;
  type: string;
  attempts: number;
  owner_display_name: string;
  owner_email: string;
  lead_name: string;
  lead_email: string;
  lead_message: string;
  lead_created_at: string;
};

export function aClaimedLeadEvent(overrides: Partial<ClaimedOutboxEvent> = {}): ClaimedOutboxEvent {
  return {
    id: OUTBOX_EVENT_IDS[0],
    type: "lead.created",
    attempts: 1,
    owner_display_name: "Élodie Durand-Mérel",
    owner_email: "elodie.durand@owner.example",
    lead_name: "Jeanne Martin",
    lead_email: "jeanne.martin@client.example",
    lead_message: "Bonjour,\nje souhaite un devis.\nMerci !",
    lead_created_at: "2026-11-18T09:30:00.000Z",
    ...overrides,
  };
}
