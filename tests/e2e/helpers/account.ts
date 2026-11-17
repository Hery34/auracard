import { randomUUID } from "node:crypto";

import { imageBytes } from "../../builders/images";
import { adminClient, type CarnetClient } from "../../integration/setup/clients";
import ensureSupabaseEnv from "../../integration/setup/supabase-env";
import { MEDIA_BUCKET } from "./profile-images";

let client: CarnetClient | undefined;

/** `service_role` client of the local stack (same guard as `admin.ts`): fixtures and reads behind the application. */
function admin(): CarnetClient {
  if (client === undefined) {
    ensureSupabaseEnv();
    client = adminClient();
  }
  return client;
}

/** Fixture: one avatar object in the profile's folder of `carnet-media`, referenced by the profile row. */
export async function giveAvatar(profileId: string): Promise<string> {
  const name = `${profileId}/avatar-${randomUUID()}.jpg`;
  const { error } = await admin().storage.from(MEDIA_BUCKET).upload(name, imageBytes("jpeg"), { contentType: "image/jpeg" });
  if (error !== null) {
    throw error;
  }
  const { error: rowError } = await admin().from("profiles").update({ avatar_url: name }).eq("id", profileId);
  if (rowError !== null) {
    throw rowError;
  }
  return name;
}

/** False once GoTrue no longer knows the account (`auth.admin.getUserById` → 404). */
export async function accountExists(userId: string): Promise<boolean> {
  const { data, error } = await admin().auth.admin.getUserById(userId);
  if (error !== null) {
    if (error.status === 404) {
      return false;
    }
    throw error;
  }
  return data.user !== null;
}
