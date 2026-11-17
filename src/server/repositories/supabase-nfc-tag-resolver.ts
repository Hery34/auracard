import type { NfcResolution } from "@/domain/nfc/nfc-tag";
import type { NfcTagResolver } from "@/domain/nfc/ports";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

/**
 * `carnet.resolve_nfc_tag` as written in SQL: one row whose `slug` is null unless the state is `active`. The generated
 * types declare neither the nullable slug nor the states, so the client is viewed through this signature.
 */
type ResolveNfcTagClient = {
  rpc(
    fn: "resolve_nfc_tag",
    args: { p_uid: string },
  ): {
    maybeSingle(): PromiseLike<{ data: { state: string; slug: string | null } | null; error: { code: string } | null }>;
  };
};

/** `carnet.resolve_nfc_tag` (security definer) through the cookie-less anonymous client. */
export function makeSupabaseNfcTagResolver(client: CarnetClient): NfcTagResolver {
  const resolver = client as unknown as ResolveNfcTagClient;
  return {
    async resolve(uid) {
      const { data, error } = await resolver.rpc("resolve_nfc_tag", { p_uid: uid }).maybeSingle();
      if (error !== null) {
        logInfrastructureError("resolve_nfc_tag", error.code);
        return err("unexpected");
      }
      const resolution = toResolution(data);
      if (resolution === null) {
        logInfrastructureError("resolve_nfc_tag", "unknown_state");
        return err("unexpected");
      }
      return ok(resolution);
    },
  };
}

function toResolution(row: { state: string; slug: string | null } | null): NfcResolution | null {
  if (row === null || row.state === "not_found") {
    return { state: "not_found" };
  }
  if (row.state === "activation") {
    return { state: "activation" };
  }
  if (row.state === "active" && row.slug !== null) {
    return { state: "active", slug: row.slug };
  }
  return null;
}
