import type { ActivationOutcome, OwnNfcTag, OwnNfcTagStatus } from "@/domain/nfc/nfc-tag";
import type { NfcTagRepository, NfcTagRepositoryError } from "@/domain/nfc/ports";
import { err, ok, type Result } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

const INSUFFICIENT_PRIVILEGE = "42501";

/** Column privileges of 0024: never `*`, never `activation_code_hash`. */
const OWN_TAG_COLUMNS = "id, uid, status, activated_at";

const ACTIVATION_OUTCOMES: readonly string[] = [
  "activated",
  "already_yours",
  "invalid",
  "no_profile",
  "rate_limited",
] satisfies ActivationOutcome[];

const OWN_TAG_STATUSES: readonly string[] = ["assigned", "disabled"] satisfies OwnNfcTagStatus[];

type PostgrestFailure = { code: string };

/**
 * `carnet.nfc_tags` and its functions under the session of the server client: RLS and the functions restrict
 * everything to the caller's tags. `activate_nfc_tag` answers one of the five outcomes; `status` is
 * `stock | assigned | disabled` (the generated types say `string`, narrowed here).
 */
export function makeSupabaseNfcTagRepository(server: CarnetClient): NfcTagRepository {
  return {
    async activate(uid, code) {
      const { data, error } = await server.rpc("activate_nfc_tag", { p_uid: uid, p_code: code });
      if (error !== null) {
        return failure("activate_nfc_tag", error);
      }
      if (!isActivationOutcome(data)) {
        logInfrastructureError("activate_nfc_tag", "unknown_outcome");
        return err("unexpected");
      }
      return ok(data);
    },

    async listOwn() {
      const { data, error } = await server
        .from("nfc_tags")
        .select(OWN_TAG_COLUMNS)
        .order("activated_at", { ascending: false });
      if (error !== null) {
        logInfrastructureError("nfc_tags.select_own", error.code);
        return err("unexpected");
      }
      const tags: OwnNfcTag[] = [];
      for (const row of data) {
        if (isOwnTagStatus(row.status)) {
          tags.push({ id: row.id, uid: row.uid, status: row.status, activatedAt: row.activated_at });
        }
      }
      return ok(tags);
    },

    async setEnabled(tagId, enabled) {
      const { data, error } = await server.rpc("set_nfc_tag_enabled", { p_tag_id: tagId, p_enabled: enabled });
      if (error !== null) {
        return failure("set_nfc_tag_enabled", error);
      }
      return ok(data === true);
    },

    async release(tagId) {
      const { data, error } = await server.rpc("release_nfc_tag", { p_tag_id: tagId });
      if (error !== null) {
        return failure("release_nfc_tag", error);
      }
      return ok(data === true);
    },
  };
}

function failure(source: string, error: PostgrestFailure): Result<never, NfcTagRepositoryError> {
  if (error.code === INSUFFICIENT_PRIVILEGE) {
    return err("not_member");
  }
  logInfrastructureError(source, error.code);
  return err("unexpected");
}

function isActivationOutcome(value: unknown): value is ActivationOutcome {
  return typeof value === "string" && ACTIVATION_OUTCOMES.includes(value);
}

function isOwnTagStatus(value: string): value is OwnNfcTagStatus {
  return OWN_TAG_STATUSES.includes(value);
}
