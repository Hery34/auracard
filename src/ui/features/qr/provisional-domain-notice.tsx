import { PROVISIONAL_DOMAIN_MESSAGE } from "@/ui/features/qr/messages";

/** Decision 8: shown on every visit while `QR_PRINT_READY` is not `true`. */
export function ProvisionalDomainNotice() {
  return (
    <p role="note" className="rounded-md border border-destructive bg-destructive/10 p-3 font-medium text-foreground">
      {PROVISIONAL_DOMAIN_MESSAGE}
    </p>
  );
}
