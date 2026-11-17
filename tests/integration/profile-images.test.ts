/**
 * 0021 — criteria 1 to 3 against the local Supabase stack with Storage (bucket `carnet-media`, policies carnet_media_*,
 * carnet.set_profile_image). Adapters under test (contract frozen by test-engineer):
 *
 * // src/server/adapters/supabase-media-storage.ts
 * export function makeSupabaseMediaStorage(server: CarnetClient): MediaStorage;
 * // upload: server.storage.from("carnet-media").upload(name, bytes, { contentType, upsert: false }) under the session;
 * // remove: .remove([name]) (file and row; an absent object is a success). Errors → unexpected, status logged only.
 * // src/server/repositories/supabase-profile-image-writer.ts
 * export function makeSupabaseProfileImageWriter(server: CarnetClient): ProfileImageWriter;
 * // rpc("set_profile_image", { p_kind, p_object_name }) → ok({ previous: data }); 42501 → not_found; else unexpected.
 * // Readers: makeSupabaseProfileReader(server, mediaOrigin), makeSupabasePublicProfileReader(client, mediaOrigin).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { isProfileImageObjectName } from "@/domain/profile/profile-image";
import { err, ok } from "@/domain/shared/result";
import { makeSupabaseAuthGateway } from "@/server/infrastructure/supabase/auth-gateway";
import { makeSupabaseLinkRepository } from "@/server/repositories/supabase-link-repository";
import { makeSupabaseMediaStorage } from "@/server/adapters/supabase-media-storage";
import { makeSupabaseProfileImageWriter } from "@/server/repositories/supabase-profile-image-writer";
import { makeSupabaseProfileReader } from "@/server/repositories/supabase-profile-reader";
import { makeSupabaseProfileWriter } from "@/server/repositories/supabase-profile-writer";
import { makeSupabasePublicProfileReader } from "@/server/repositories/supabase-public-profile-reader";
import { makeSupabaseRateLimiter } from "@/server/repositories/supabase-rate-limiter";
import { makeGetOwnProfile } from "@/server/use-cases/get-own-profile";
import { makeGetPublicProfile } from "@/server/use-cases/get-public-profile";
import { makeRemoveProfileImage } from "@/server/use-cases/remove-profile-image";
import { makeUpdateProfile } from "@/server/use-cases/update-profile";
import { makeUploadProfileImage } from "@/server/use-cases/upload-profile-image";

import { imageBytes, textBytes } from "../builders/images";
import { aProfileUpdate } from "../builders/profile-update";
import { deleteUsersByEmail } from "./setup/cleanup";
import { adminClient, anonClient, type CarnetClient } from "./setup/clients";
import { RUN_SECRET } from "./setup/fixtures";
import { createMember, createOutsider } from "./setup/members";

const BUCKET = "carnet-media";

function mediaOrigin(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (value === undefined) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL missing (globalSetup)");
  }
  return value;
}

function publicUrlOf(objectName: string): string {
  return `${mediaOrigin().replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}/${objectName}`;
}

function objectNameOf(url: string | null): string {
  const prefix = `/storage/v1/object/public/${BUCKET}/`;
  const path = new URL(url ?? "").pathname;
  expect(path.startsWith(prefix)).toBe(true);
  return path.slice(prefix.length);
}

describe("profile images against the local Supabase stack (Storage included)", () => {
  const admin = adminClient();
  const emails: string[] = [];
  const folders: string[] = [];

  function track(email: string): string {
    emails.push(email);
    return email;
  }

  function casesOn(session: CarnetClient) {
    const deps = {
      auth: makeSupabaseAuthGateway(session),
      rateLimiter: makeSupabaseRateLimiter(admin, RUN_SECRET),
      profiles: makeSupabaseProfileReader(session, mediaOrigin()),
      storage: makeSupabaseMediaStorage(session),
      images: makeSupabaseProfileImageWriter(session),
    };
    return {
      uploadProfileImage: makeUploadProfileImage({
        ...deps,
        ids: { uuid: () => crypto.randomUUID() },
        mediaUrl: (name) => publicUrlOf(name),
      }),
      removeProfileImage: makeRemoveProfileImage(deps),
      updateProfile: makeUpdateProfile({ ...deps, writer: makeSupabaseProfileWriter(session) }),
      getOwnProfile: makeGetOwnProfile({
        auth: deps.auth,
        profiles: deps.profiles,
        links: makeSupabaseLinkRepository(session),
      }),
    };
  }

  function publicRead() {
    return makeGetPublicProfile({ publicProfiles: makeSupabasePublicProfileReader(anonClient(), mediaOrigin()) });
  }

  async function imageColumns(profileId: string) {
    const { data, error } = await admin
      .from("profiles")
      .select("avatar_url, banner_url, logo_url")
      .eq("id", profileId)
      .single();
    expect(error).toBeNull();
    if (data === null) throw error ?? new Error("no row");
    return data;
  }

  async function objectsIn(profileId: string): Promise<string[]> {
    const { data, error } = await admin.storage.from(BUCKET).list(profileId);
    expect(error).toBeNull();
    return (data ?? []).map((object) => `${profileId}/${object.name}`).sort();
  }

  async function memberWithFolder() {
    const member = await createMember(admin, track);
    folders.push(member.profileId);
    return member;
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const folder of folders.splice(0)) {
      const names = await objectsIn(folder);
      if (names.length > 0) {
        await admin.storage.from(BUCKET).remove(names);
      }
    }
    const { survivingProfileIds } = await deleteUsersByEmail(admin, emails.splice(0));

    expect(survivingProfileIds).toStrictEqual([]);
  });

  describe("criterion 1: upload, replacement and removal by the owner", () => {
    it("upload: the file is in the owner's folder, avatar_url holds its object name, its public URL serves the bytes", async () => {
      const member = await memberWithFolder();
      const bytes = imageBytes("png", 2048);

      const result = await casesOn(member.session).uploadProfileImage("avatar", bytes);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const name = objectNameOf(result.value.url);
      expect(name).toMatch(
        new RegExp(`^${member.profileId}/avatar-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.png$`),
      );
      expect(result.value).toStrictEqual({ profileId: member.profileId, slug: member.slug, url: publicUrlOf(name) });
      expect(await imageColumns(member.profileId)).toStrictEqual({ avatar_url: name, banner_url: null, logo_url: null });
      expect(await objectsIn(member.profileId)).toStrictEqual([name]);

      const response = await fetch(publicUrlOf(name));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect([...new Uint8Array(await response.arrayBuffer())]).toStrictEqual([...bytes]);
    });

    it("banner and logo: each kind in its own column, real type from the bytes (.webp, .jpg)", async () => {
      const member = await memberWithFolder();
      const { uploadProfileImage } = casesOn(member.session);

      const banner = await uploadProfileImage("banner", imageBytes("webp", 1024));
      const logo = await uploadProfileImage("logo", imageBytes("jpeg", 1024));

      const columns = await imageColumns(member.profileId);
      expect(columns.avatar_url).toBeNull();
      expect(columns.banner_url).toBe(objectNameOf(banner.ok ? banner.value.url : null));
      expect(columns.banner_url).toMatch(/\/banner-[0-9a-f-]{36}\.webp$/);
      expect(columns.logo_url).toBe(objectNameOf(logo.ok ? logo.value.url : null));
      expect(columns.logo_url).toMatch(/\/logo-[0-9a-f-]{36}\.jpg$/);
    });

    it("replacement: the previous file is deleted from Storage (no longer served), only the new one remains", async () => {
      const member = await memberWithFolder();
      const { uploadProfileImage } = casesOn(member.session);
      const first = await uploadProfileImage("avatar", imageBytes("jpeg", 1024));
      const firstName = objectNameOf(first.ok ? first.value.url : null);

      const second = await uploadProfileImage("avatar", imageBytes("png", 1024));
      const secondName = objectNameOf(second.ok ? second.value.url : null);

      expect(secondName).not.toBe(firstName);
      expect(await objectsIn(member.profileId)).toStrictEqual([secondName]);
      expect((await imageColumns(member.profileId)).avatar_url).toBe(secondName);
      expect((await fetch(publicUrlOf(firstName))).ok).toBe(false);
      expect((await fetch(publicUrlOf(secondName))).ok).toBe(true);
    });

    it("removal: the reference is cleared and the file deleted; executed twice → same state, ok twice", async () => {
      const member = await memberWithFolder();
      const { uploadProfileImage, removeProfileImage } = casesOn(member.session);
      const uploaded = await uploadProfileImage("avatar", imageBytes("jpeg", 1024));
      const name = objectNameOf(uploaded.ok ? uploaded.value.url : null);

      const first = await removeProfileImage("avatar");
      const second = await removeProfileImage("avatar");

      expect(first).toStrictEqual(ok({ profileId: member.profileId, slug: member.slug }));
      expect(second).toStrictEqual(first);
      expect((await imageColumns(member.profileId)).avatar_url).toBeNull();
      expect(await objectsIn(member.profileId)).toStrictEqual([]);
      expect((await fetch(publicUrlOf(name))).ok).toBe(false);
    });

    it("idempotence: the same upload executed twice → one file in the folder, the reference of the last one", async () => {
      const member = await memberWithFolder();
      const { uploadProfileImage } = casesOn(member.session);
      const bytes = imageBytes("jpeg", 1024);

      await uploadProfileImage("avatar", bytes);
      const last = await uploadProfileImage("avatar", bytes);

      const lastName = objectNameOf(last.ok ? last.value.url : null);
      expect(await objectsIn(member.profileId)).toStrictEqual([lastName]);
      expect((await imageColumns(member.profileId)).avatar_url).toBe(lastName);
    });
  });

  describe("criterion 1: no other account, project nor anon writes in the folder", () => {
    async function ownerWithAvatar() {
      const owner = await memberWithFolder();
      const uploaded = await casesOn(owner.session).uploadProfileImage("avatar", imageBytes("jpeg", 1024));
      return { owner, avatar: objectNameOf(uploaded.ok ? uploaded.value.url : null) };
    }

    it("another member of carnet: cannot upload, overwrite nor delete in the owner's folder, nor point set_profile_image at the owner's file", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { owner, avatar } = await ownerWithAvatar();
      const other = await memberWithFolder();
      const storage = makeSupabaseMediaStorage(other.session);
      const intruderName = `${owner.profileId}/avatar-0f0e0d0c-0000-4000-8000-00000000000a.jpg`;

      expect(
        await storage.upload({ objectName: intruderName, bytes: imageBytes("jpeg"), contentType: "image/jpeg" }),
      ).toStrictEqual(err("unexpected"));
      expect(await storage.upload({ objectName: avatar, bytes: imageBytes("jpeg"), contentType: "image/jpeg" })).toStrictEqual(
        err("unexpected"),
      );
      await storage.remove(avatar);
      expect(await makeSupabaseProfileImageWriter(other.session).set("avatar", avatar)).toStrictEqual(err("unexpected"));

      expect(await objectsIn(owner.profileId)).toStrictEqual([avatar]);
      expect((await imageColumns(owner.profileId)).avatar_url).toBe(avatar);
      expect((await imageColumns(other.profileId)).avatar_url).toBeNull();
    });

    it("an account of another project: uploadProfileImage → not_found, direct writes refused, nothing stored", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { owner, avatar } = await ownerWithAvatar();
      const outsider = await createOutsider(admin, track);

      expect(await casesOn(outsider.session).uploadProfileImage("avatar", imageBytes("png"))).toStrictEqual(
        err("not_found"),
      );
      expect(
        await makeSupabaseMediaStorage(outsider.session).upload({
          objectName: `${owner.profileId}/avatar-0f0e0d0c-0000-4000-8000-00000000000b.png`,
          bytes: imageBytes("png"),
          contentType: "image/png",
        }),
      ).toStrictEqual(err("unexpected"));
      await makeSupabaseMediaStorage(outsider.session).remove(avatar);
      expect(await makeSupabaseProfileImageWriter(outsider.session).set("avatar", null)).toStrictEqual(err("not_found"));

      expect(await objectsIn(owner.profileId)).toStrictEqual([avatar]);
    });

    it("anon: cannot upload nor delete; reads the public URL only", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { owner, avatar } = await ownerWithAvatar();
      const storage = makeSupabaseMediaStorage(anonClient());

      expect(
        await storage.upload({
          objectName: `${owner.profileId}/avatar-0f0e0d0c-0000-4000-8000-00000000000c.png`,
          bytes: imageBytes("png"),
          contentType: "image/png",
        }),
      ).toStrictEqual(err("unexpected"));
      await storage.remove(avatar);

      expect(await objectsIn(owner.profileId)).toStrictEqual([avatar]);
      expect((await fetch(publicUrlOf(avatar))).ok).toBe(true);
    });
  });

  describe("criterion 2: refused files", () => {
    it.each([
      ["a text file renamed .png", textBytes("Ceci n'est pas une image"), "invalid_file"],
      ["an empty file", new Uint8Array(), "invalid_file"],
      ["a file of 2 MiB + 1 byte", imageBytes("jpeg", 2 * 1024 * 1024 + 1), "too_large"],
      ["decision 12: a PNG of 1501 × 10", imageBytes("png", 1024, { width: 1501, height: 10 }), "invalid_file"],
    ] as const)("%s → %s, nothing stored, no reference", async (_label, bytes, error) => {
      const member = await memberWithFolder();

      expect(await casesOn(member.session).uploadProfileImage("avatar", bytes)).toStrictEqual(err(error));
      expect(await objectsIn(member.profileId)).toStrictEqual([]);
      expect((await imageColumns(member.profileId)).avatar_url).toBeNull();
    });
  });

  describe("criterion 3: reads build the public URLs", () => {
    it("getOwnProfile (preview) and the public profile give the public URLs of the three images", async () => {
      const member = await memberWithFolder();
      const { uploadProfileImage, updateProfile, getOwnProfile } = casesOn(member.session);
      await updateProfile(aProfileUpdate({ isPublished: true }));
      const avatar = await uploadProfileImage("avatar", imageBytes("jpeg", 1024));
      const banner = await uploadProfileImage("banner", imageBytes("webp", 1024));
      const logo = await uploadProfileImage("logo", imageBytes("png", 1024));
      const urls = {
        avatarUrl: avatar.ok ? avatar.value.url : "missing",
        bannerUrl: banner.ok ? banner.value.url : "missing",
        logoUrl: logo.ok ? logo.value.url : "missing",
      };

      const own = await getOwnProfile();
      expect(own.ok && own.value.profile).toMatchObject(urls);
      const published = await publicRead()(member.slug);
      expect(published.ok && published.value).toMatchObject(urls);
    });
  });
});

describe("decision 12: the domain and carnet.is_valid_media_name agree on the object names", () => {
  const FOLDER = "c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
  const UUID = "1a2b3c4d-0000-4000-8000-000000000001";
  const VALID = `${FOLDER}/avatar-${UUID}.jpg`;
  const NAMES: readonly string[] = [
    VALID,
    `${FOLDER}/banner-${UUID}.png`,
    `${FOLDER}/logo-${UUID}.webp`,
    `${FOLDER}/photo-${UUID}.jpg`,
    `${FOLDER}/avatar-${UUID}.jpeg`,
    `${FOLDER}/avatar-${UUID}.gif`,
    `${FOLDER}/avatar-${UUID}.JPG`,
    `${FOLDER}/Avatar-${UUID}.jpg`,
    `${FOLDER}/avatar-${UUID.toUpperCase()}.jpg`,
    `${FOLDER.toUpperCase()}/avatar-${UUID}.jpg`,
    `${FOLDER}/avatar-${UUID.replaceAll("-", "")}.jpg`,
    `${FOLDER}/avatar-${UUID}0.jpg`,
    `elodie/avatar-${UUID}.jpg`,
    `/${VALID}`,
    `${FOLDER}/x/avatar-${UUID}.jpg`,
    `${FOLDER}/../${FOLDER}/avatar-${UUID}.jpg`,
    `${FOLDER}%2Favatar-${UUID}.jpg`,
    `${VALID}?download=1`,
    `${VALID}#x`,
    `${VALID}\n`,
    `\n${VALID}`,
    ` ${VALID}`,
    `${VALID} `,
    `${VALID}/`,
    `${FOLDER}/avatar-${UUID}`,
    `${FOLDER}/avatar-${UUID}.`,
    `${FOLDER}/avatar-.jpg`,
    `${FOLDER}/-${UUID}.jpg`,
    "https://cdn.example/avatar.jpg",
    UUID,
    "",
  ];

  it("same answer for every name of the table (one validation, no drift)", async () => {
    const admin = adminClient();
    const fromDatabase: Array<[string, boolean | null]> = [];
    for (const name of NAMES) {
      const { data, error } = await admin.rpc("is_valid_media_name", { p_name: name });
      expect(error, name).toBeNull();
      fromDatabase.push([name, data]);
    }

    expect(fromDatabase).toStrictEqual(NAMES.map((name) => [name, isProfileImageObjectName(name)]));
    expect(fromDatabase.filter(([, valid]) => valid).map(([name]) => name)).toStrictEqual([
      VALID,
      `${FOLDER}/banner-${UUID}.png`,
      `${FOLDER}/logo-${UUID}.webp`,
    ]);
  });
});
