import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";

import { adminClient, anonClient, type CarnetClient } from "../../integration/setup/clients";
import ensureSupabaseEnv from "../../integration/setup/supabase-env";
import { PASSWORD, newClientAddress } from "./accounts";

export type Tag = { uid: string; activationCode: string; batchId: string };

let client: CarnetClient | undefined;

/** `service_role` client of the local stack (same guard as `admin.ts`): stands for the psql script of 0025 (decision 9). */
function admin(): CarnetClient {
  if (client === undefined) {
    ensureSupabaseEnv();
    client = adminClient();
  }
  return client;
}

const batches: string[] = [];

/** One tag in stock, in its own batch (`provision_nfc_tags`, service_role only): uid and code as printed on the card. */
export async function provisionTag(): Promise<Tag> {
  const batchId = randomUUID();
  batches.push(batchId);
  const { data, error } = await admin().rpc("provision_nfc_tags", { p_batch_id: batchId, p_count: 1 });
  if (error !== null) {
    throw error;
  }
  const [row] = data;
  if (row === undefined) {
    throw new Error("provision_nfc_tags returned no tag");
  }
  return { uid: row.uid, activationCode: row.activation_code, batchId };
}

/** Removes every tag provisioned by this worker (the accounts are removed by the global teardown). */
export async function deleteProvisionedTags(): Promise<void> {
  const ids = batches.splice(0);
  if (ids.length === 0) {
    return;
  }
  const { error } = await admin().from("nfc_tags").delete().in("batch_id", ids);
  if (error !== null) {
    throw error;
  }
}

export async function tagStateOf(uid: string): Promise<{ id: string; status: string; profile_id: string | null }> {
  const { data, error } = await admin().from("nfc_tags").select("id, status, profile_id").eq("uid", uid).single();
  if (error !== null) {
    throw error;
  }
  return data;
}

/** Signed-in Supabase client of a member (fixtures under `authenticated`, behind the application). */
async function sessionOf(email: string): Promise<CarnetClient> {
  ensureSupabaseEnv();
  const session = anonClient();
  const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
  if (error !== null) {
    throw error;
  }
  return session;
}

/** Fixture: the member activates the tag directly through `activate_nfc_tag`, without the page. */
export async function activateBehindTheApplication(email: string, tag: Tag): Promise<string> {
  const session = await sessionOf(email);
  const { data, error } = await session.rpc("activate_nfc_tag", { p_uid: tag.uid, p_code: tag.activationCode });
  if (error !== null) {
    throw error;
  }
  expect(data).toBe("activated");
  return (await tagStateOf(tag.uid)).id;
}

/** Fixture: the owner disables the tag through `set_nfc_tag_enabled`. */
export async function disableBehindTheApplication(email: string, tagId: string): Promise<void> {
  const session = await sessionOf(email);
  const { data, error } = await session.rpc("set_nfc_tag_enabled", { p_tag_id: tagId, p_enabled: false });
  if (error !== null) {
    throw error;
  }
  expect(data).toBe(true);
}

/** QR code of the member's profile (`ensure_qr_code`, created on first call). */
export async function qrCodeOf(email: string): Promise<string> {
  const session = await sessionOf(email);
  const { data, error } = await session.rpc("ensure_qr_code");
  if (error !== null || data === null) {
    throw error ?? new Error("ensure_qr_code returned nothing");
  }
  return data.code;
}

/** Every later request of the page leaves from a fresh client address (per-address login and activation counters). */
export async function freshAddress(page: Page): Promise<void> {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": newClientAddress() });
}

/** Fills the sign-in form already displayed and submits it; the caller asserts where it lands. */
export async function submitSignIn(page: Page, email: string): Promise<void> {
  await page.getByLabel("Adresse e-mail", { exact: true }).fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

/** Signs in through /connexion (fresh address) and waits for the dashboard. */
export async function signIn(page: Page, email: string): Promise<void> {
  await freshAddress(page);
  await page.goto("/connexion");
  await submitSignIn(page, email);
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
}
