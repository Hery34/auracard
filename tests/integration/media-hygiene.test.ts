/**
 * 0027 — criteria 2, 3 and 5 against the local Supabase stack, through the same HTTP calls as the n8n workflow
 * (`n8n/workflows/carnet-media-purge.json`, structure frozen in n8n-media-purge-workflow.test.ts):
 * // POST   <url>/rest/v1/rpc/list_orphan_media   Content-Profile: carnet   { "p_older_than": "<interval>" } → [{ "name" }]
 * // DELETE <url>/storage/v1/object/carnet-media                            { "prefixes": [<names>] }       → 200
 * Raw `fetch` on purpose: the function is reserved to n8n (service_role), the application has no adapter for it.
 * The upload cap (6 objects per profile folder) is checked through the Storage API under the member's session.
 * Report 3: the delay is at least 1 hour (22023 below) and objects cannot be aged through the API, so the listing
 * of old orphans is covered by pgTAP (supabase/tests/carnet_media_hygiene.test.sql) only.
 */
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { imageBytes } from "../builders/images";
import { deleteUsersByEmail } from "./setup/cleanup";
import { adminClient } from "./setup/clients";
import { createMember } from "./setup/members";

const BUCKET = "carnet-media";

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} missing (globalSetup)`);
  }
  return value;
}

function baseUrl(): string {
  return env("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
}

function headers(apiKey: string, bearer: string): Record<string, string> {
  return { apikey: apiKey, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" };
}

function serviceHeaders(): Record<string, string> {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  return headers(key, key);
}

async function listOrphanMedia(olderThan: string, auth: Record<string, string> = serviceHeaders()): Promise<Response> {
  return fetch(`${baseUrl()}/rest/v1/rpc/list_orphan_media`, {
    method: "POST",
    headers: { ...auth, "Content-Profile": "carnet" },
    body: JSON.stringify({ p_older_than: olderThan }),
  });
}

async function orphanNames(olderThan: string): Promise<string[]> {
  const response = await listOrphanMedia(olderThan);
  expect(response.status).toBe(200);
  const rows = (await response.json()) as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

async function deleteBatch(names: string[]): Promise<Response> {
  return fetch(`${baseUrl()}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: serviceHeaders(),
    body: JSON.stringify({ prefixes: names }),
  });
}

function objectName(folder: string, kind: "avatar" | "banner" | "logo"): string {
  return `${folder}/${kind}-${randomUUID()}.jpg`;
}

describe("media hygiene against the local Supabase stack (0027)", () => {
  const admin = adminClient();
  const emails: string[] = [];
  const folders: string[] = [];

  function track(email: string): string {
    emails.push(email);
    return email;
  }

  async function objectsIn(folder: string): Promise<string[]> {
    const { data, error } = await admin.storage.from(BUCKET).list(folder);
    if (error !== null) throw error;
    return data.map((object) => `${folder}/${object.name}`).sort();
  }

  async function adminUpload(name: string): Promise<void> {
    const { error } = await admin.storage
      .from(BUCKET)
      .upload(name, imageBytes("jpeg"), { contentType: "image/jpeg", upsert: false });
    if (error !== null) throw error;
  }

  afterEach(async () => {
    for (const folder of folders.splice(0)) {
      const names = await objectsIn(folder);
      if (names.length > 0) {
        const { error } = await admin.storage.from(BUCKET).remove(names);
        if (error !== null) throw error;
      }
    }
    await deleteUsersByEmail(admin, emails.splice(0));
  });

  describe("criterion 2: list_orphan_media is reserved to service_role", () => {
    it("anon is refused (42501)", async () => {
      const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");

      const response = await listOrphanMedia("24 hours", headers(anonKey, anonKey));

      expect(response.ok).toBe(false);
      expect(((await response.json()) as { code?: string }).code).toBe("42501");
    });

    it("a signed-in member (authenticated) is refused (42501)", async () => {
      const member = await createMember(admin, track);
      const { data } = await member.session.auth.getSession();
      const token = data.session?.access_token;
      if (token === undefined) throw new Error("no session");

      const response = await listOrphanMedia("24 hours", headers(env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), token));

      expect(response.ok).toBe(false);
      expect(((await response.json()) as { code?: string }).code).toBe("42501");
    });
  });

  describe("criteria 1 and 5: list then delete, as the workflow does", () => {
    it("report 3: a delay under 1 hour is refused (22023); 24 hours and 1 hour are accepted", async () => {
      const refused = await listOrphanMedia("0 seconds");
      expect(refused.ok).toBe(false);
      expect(((await refused.json()) as { code?: string }).code).toBe("22023");

      expect((await listOrphanMedia("24 hours")).status).toBe(200);
      expect((await listOrphanMedia("1 hour")).status).toBe(200);
    });

    it("a fresh unreferenced object is not listed; its deletion, replayed, raises no error", async () => {
      const folder = randomUUID();
      folders.push(folder);
      const orphan = objectName(folder, "avatar");
      await adminUpload(orphan);

      expect(await orphanNames("1 hour")).not.toContain(orphan);

      const first = await deleteBatch([orphan]);
      expect(first.status).toBe(200);
      const replay = await deleteBatch([orphan]);
      expect(replay.status).toBe(200);

      expect(await objectsIn(folder)).toStrictEqual([]);
    });
  });

  describe("criterion 3: at most 6 objects per profile folder", () => {
    it("the replacement of an image (4th object) is accepted; the 7th upload is refused", async () => {
      const member = await createMember(admin, track);
      folders.push(member.profileId);
      const upload = (name: string) =>
        member.session.storage.from(BUCKET).upload(name, imageBytes("jpeg"), { contentType: "image/jpeg", upsert: false });

      for (const kind of ["avatar", "banner", "logo"] as const) {
        expect((await upload(objectName(member.profileId, kind))).error).toBeNull();
      }
      expect((await upload(objectName(member.profileId, "avatar"))).error).toBeNull();
      expect((await upload(objectName(member.profileId, "banner"))).error).toBeNull();
      expect((await upload(objectName(member.profileId, "logo"))).error).toBeNull();

      const seventh = await upload(objectName(member.profileId, "avatar"));

      expect(seventh.error).not.toBeNull();
      expect(await objectsIn(member.profileId)).toHaveLength(6);
    });

    it("a full folder does not affect another member's folder", async () => {
      const full = await createMember(admin, track);
      const other = await createMember(admin, track);
      folders.push(full.profileId, other.profileId);
      for (let index = 0; index < 6; index += 1) {
        await adminUpload(objectName(full.profileId, "avatar"));
      }

      const { error } = await other.session.storage
        .from(BUCKET)
        .upload(objectName(other.profileId, "avatar"), imageBytes("jpeg"), { contentType: "image/jpeg", upsert: false });

      expect(error).toBeNull();
    });
  });
});
