import type { QrCodeResolver } from "@/domain/nfc/ports";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

/** `carnet.resolve_qr_code` as written in SQL: `null` for an unknown code or an unpublished profile. */
type ResolveQrCodeClient = {
  rpc(
    fn: "resolve_qr_code",
    args: { p_code: string },
  ): PromiseLike<{ data: string | null; error: { code: string } | null }>;
};

/** `carnet.resolve_qr_code` (security definer) through the cookie-less anonymous client. */
export function makeSupabaseQrCodeResolver(client: CarnetClient): QrCodeResolver {
  const resolver = client as unknown as ResolveQrCodeClient;
  return {
    async resolve(code) {
      const { data, error } = await resolver.rpc("resolve_qr_code", { p_code: code });
      if (error !== null) {
        logInfrastructureError("resolve_qr_code", error.code);
        return err("unexpected");
      }
      return ok(data);
    },
  };
}
