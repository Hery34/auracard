import { randomUUID } from "node:crypto";

import type { CarnetClient } from "./clients";

export type ProvisionedTag = { uid: string; activationCode: string };

export type TagRow = {
  id: string;
  uid: string;
  status: string;
  profile_id: string | null;
  batch_id: string;
  activated_at: string | null;
  updated_at: string;
};

/**
 * Creates `count` tags in stock through `carnet.provision_nfc_tags` (service_role only, 0024) in a fresh batch, whose
 * id is handed to `track` for the cleanup. Stands for the psql script of decision 9 in the tests that need tags.
 */
export async function provisionTags(
  admin: CarnetClient,
  count: number,
  track: (batchId: string) => string,
): Promise<ProvisionedTag[]> {
  const batchId = track(randomUUID());
  const { data, error } = await admin.rpc("provision_nfc_tags", { p_batch_id: batchId, p_count: count });
  if (error !== null) {
    throw error;
  }
  return data.map((row) => ({ uid: row.uid, activationCode: row.activation_code }));
}

/** Row of a tag read behind the application (service_role), hash excluded. */
export async function tagRow(admin: CarnetClient, uid: string): Promise<TagRow> {
  const { data, error } = await admin
    .from("nfc_tags")
    .select("id, uid, status, profile_id, batch_id, activated_at, updated_at")
    .eq("uid", uid)
    .single();
  if (error !== null) {
    throw error;
  }
  return data;
}

export async function tagsOfBatch(admin: CarnetClient, batchId: string): Promise<TagRow[]> {
  const { data, error } = await admin
    .from("nfc_tags")
    .select("id, uid, status, profile_id, batch_id, activated_at, updated_at")
    .eq("batch_id", batchId);
  if (error !== null) {
    throw error;
  }
  return data;
}

export async function countTags(admin: CarnetClient): Promise<number> {
  const { count, error } = await admin.from("nfc_tags").select("id", { count: "exact", head: true });
  if (error !== null || count === null) {
    throw error ?? new Error("count unavailable");
  }
  return count;
}

export async function deleteBatches(admin: CarnetClient, batchIds: readonly string[]): Promise<void> {
  if (batchIds.length === 0) {
    return;
  }
  const { error } = await admin.from("nfc_tags").delete().in("batch_id", [...batchIds]);
  if (error !== null) {
    throw error;
  }
}

export async function setPublished(admin: CarnetClient, profileId: string, published: boolean): Promise<void> {
  const { error } = await admin.from("profiles").update({ is_published: published }).eq("id", profileId);
  if (error !== null) {
    throw error;
  }
}
