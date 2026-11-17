/** Word the member types to confirm the deletion of their account (0023, decision 1). */
export const ACCOUNT_DELETION_CONFIRMATION = "SUPPRIMER";

/** Exact match only: case-sensitive, no trimming, no normalization. */
export function isAccountDeletionConfirmed(value: unknown): boolean {
  return value === ACCOUNT_DELETION_CONFIRMATION;
}
