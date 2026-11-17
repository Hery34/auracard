/**
 * Contract frozen by test-engineer (0021, decisions 1, 4, 5, 8 and 9; ADR 0014).
 *
 * // src/domain/profile/ports.ts — additions
 * export type MediaContentType = "image/jpeg" | "image/png" | "image/webp";
 * // Bucket `carnet-media` under the session of the caller (policies carnet_media_*), through the Storage API.
 * export interface MediaStorage {
 *   // Never overwrites an existing object (upsert: false). Any failure → unexpected (status logged only).
 *   upload(input: { objectName: string; bytes: Uint8Array; contentType: MediaContentType }): Promise<Result<void, "unexpected">>;
 *   // Deletes the file and its row; an object already absent is a success (replayable).
 *   remove(objectName: string): Promise<Result<void, "unexpected">>;
 * }
 * export type ProfileImageWriteError = "not_found" | "unexpected";
 * // carnet.set_profile_image(p_kind, p_object_name) under the session: the caller's own profile only.
 * // Returns the previous object name of that kind (null when none). 42501 → not_found; anything else → unexpected.
 * export interface ProfileImageWriter {
 *   set(kind: ProfileImageKind, objectName: string | null): Promise<Result<{ previous: string | null }, ProfileImageWriteError>>;
 * }
 *
 * // src/server/use-cases/upload-profile-image.ts
 * export type UploadProfileImageError =
 *   "unauthenticated" | "not_found" | "rate_limited" | "invalid_file" | "too_large" | "unexpected";
 * export type UploadProfileImage = (kind: ProfileImageKind, bytes: Uint8Array) =>
 *   Promise<Result<{ profileId: string; slug: string; url: string | null }, UploadProfileImageError>>;
 * export function makeUploadProfileImage(deps: {
 *   auth: AuthGateway; rateLimiter: RateLimiter; profiles: ProfileReader;
 *   storage: MediaStorage; images: ProfileImageWriter; ids: IdGenerator;
 *   mediaUrl: (objectName: string) => string | null;   // container: publicMediaUrl(NEXT_PUBLIC_SUPABASE_URL, name)
 * }): UploadProfileImage;
 * // Order: authorizeProfileWrite (auth.currentUser → rateLimiter.consume("profile-write", userId) → profiles.getOwn)
 * //   → validateProfileImage(bytes) → name = profileImageObjectName({ profileId: own.id, kind, uuid: ids.uuid(), format })
 * //   → storage.upload({ objectName: name, bytes, contentType: IMAGE_FORMATS[format].contentType })
 * //   → images.set(kind, name)
 * //   → previous !== null && previous !== name ? storage.remove(previous) : nothing (decision 9)
 * //   → ok({ profileId: own.id, slug: own.slug, url: mediaUrl(name) }).
 * // upload failure → unexpected, nothing recorded. set failure not_found (certain refusal) → storage.remove(name), then
 * // the error; set failure unexpected (ambiguous, decision 12) → no removal (orphan rather than a broken reference),
 * // then the error. validateProfileImage includes the dimensions (decision 12).
 * // A failed removal (orphan cleanup or previous file) never changes the result.
 */
import { describe, expect, it } from "vitest";

import type { ProfileImageKind } from "@/domain/profile/profile-image";
import { err, ok } from "@/domain/shared/result";
import { makeUploadProfileImage } from "@/server/use-cases/upload-profile-image";

import { makeCallLog } from "../../../tests/builders/call-log";
import {
  fakeAuthGateway,
  GATEWAY_USER_EMAIL,
  GATEWAY_USER_ID,
  type FakeAuthGatewayOptions,
} from "../../../tests/builders/fake-auth-gateway";
import { fakeMediaStorage, type FakeMediaStorageOptions } from "../../../tests/builders/fake-media-storage";
import {
  fakeProfileImageWriter,
  type FakeProfileImageWriterOptions,
} from "../../../tests/builders/fake-profile-image-writer";
import {
  anOwnProfile,
  fakeProfileReader,
  type FakeProfileReaderOptions,
} from "../../../tests/builders/fake-profile-reader";
import { fakeRateLimiter, type FakeRateLimiterOptions } from "../../../tests/builders/fake-rate-limiter";
import { PROFILE_ID } from "../../../tests/builders/fake-registrar";
import { FIXED_UUIDS, fixedIds } from "../../../tests/builders/fixed-ids";
import { imageBytes, textBytes } from "../../../tests/builders/images";

const OWN_SLUG = anOwnProfile().slug;
const AUTHENTICATED = ok({ userId: GATEWAY_USER_ID, email: GATEWAY_USER_EMAIL });
const PROFILE_WRITE_CONSUME = { scope: "profile-write", subject: GATEWAY_USER_ID, limit: 60, windowSeconds: 3600 };
const MEDIA_ORIGIN = "https://supabase.carnet.example";
const OLD_AVATAR = `${PROFILE_ID}/avatar-0f0e0d0c-0000-4000-8000-00000000000a.jpg`;

function nameOf(kind: ProfileImageKind, extension: "jpg" | "png" | "webp", index = 0): string {
  return `${PROFILE_ID}/${kind}-${FIXED_UUIDS[index]}.${extension}`;
}

function urlOf(objectName: string): string {
  return `${MEDIA_ORIGIN}/storage/v1/object/public/carnet-media/${objectName}`;
}

function harness(
  overrides: {
    auth?: FakeAuthGatewayOptions;
    limiter?: FakeRateLimiterOptions;
    profiles?: FakeProfileReaderOptions;
    storage?: FakeMediaStorageOptions;
    images?: FakeProfileImageWriterOptions;
    uuids?: readonly string[];
  } = {},
) {
  const log = makeCallLog();
  const storage = fakeMediaStorage({ log, ...overrides.storage });
  const images = fakeProfileImageWriter({ log, ...overrides.images });
  const uploadProfileImage = makeUploadProfileImage({
    auth: fakeAuthGateway({ log, currentUser: AUTHENTICATED, ...overrides.auth }),
    rateLimiter: fakeRateLimiter({ log, ...overrides.limiter }),
    profiles: fakeProfileReader({ log, ...overrides.profiles }),
    storage,
    images,
    ids: fixedIds(overrides.uuids),
    mediaUrl: (objectName) => {
      log.record("mediaUrl", "of", objectName);
      return urlOf(objectName);
    },
  });

  return { log, storage, images, uploadProfileImage };
}

describe("uploadProfileImage", () => {
  it("criterion 1 (upload): session → profile-write → own profile → validation → upload → set_profile_image → ok({ profileId, slug, url })", async () => {
    const bytes = imageBytes("png", 2048);
    const { log, storage, images, uploadProfileImage } = harness();
    const name = nameOf("avatar", "png");

    expect(await uploadProfileImage("avatar", bytes)).toStrictEqual(
      ok({ profileId: PROFILE_ID, slug: OWN_SLUG, url: urlOf(name) }),
    );
    expect(log.sequence().filter((call) => call !== "mediaUrl.of")).toStrictEqual([
      "auth.currentUser",
      "rateLimiter.consume",
      "profiles.getOwn",
      "storage.upload",
      "images.set",
    ]);
    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([PROFILE_WRITE_CONSUME]);
    expect(log.inputsOf("storage", "upload")).toStrictEqual([{ objectName: name, bytes, contentType: "image/png" }]);
    expect(log.inputsOf("images", "set")).toStrictEqual([{ kind: "avatar", objectName: name }]);
    expect(log.inputsOf("mediaUrl", "of")).toStrictEqual([name]);
    expect([...storage.objects]).toStrictEqual([name]);
    expect(images.current.avatar).toBe(name);
  });

  it.each([
    ["avatar", "jpeg", "jpg", "image/jpeg"],
    ["banner", "png", "png", "image/png"],
    ["logo", "webp", "webp", "image/webp"],
  ] as const)("decision 1: %s in %s → <profile_id>/%s-<uuid>.%s, content type %s", async (kind, format, extension, contentType) => {
    const bytes = imageBytes(format);
    const { log, uploadProfileImage } = harness();

    await uploadProfileImage(kind, bytes);

    expect(log.inputsOf("storage", "upload")).toStrictEqual([
      { objectName: nameOf(kind, extension), bytes, contentType },
    ]);
    expect(log.inputsOf("images", "set")).toStrictEqual([{ kind, objectName: nameOf(kind, extension) }]);
  });

  it("criterion 2: the stored type and extension come from the signature bytes, never from a declared type (WebP bytes → .webp, image/webp)", async () => {
    const { log, uploadProfileImage } = harness();

    await uploadProfileImage("avatar", imageBytes("webp"));

    expect(log.inputsOf("storage", "upload")).toMatchObject([
      { objectName: nameOf("avatar", "webp"), contentType: "image/webp" },
    ]);
  });

  it("decision 9: the uuid of the object name is in lower case even if the generator answers in upper case", async () => {
    const { log, uploadProfileImage } = harness({ uuids: [FIXED_UUIDS[0].toUpperCase()] });

    await uploadProfileImage("avatar", imageBytes("jpeg"));

    expect(log.inputsOf("images", "set")).toStrictEqual([{ kind: "avatar", objectName: nameOf("avatar", "jpg") }]);
  });

  it("criterion 1: the folder is the id of the caller's own profile (read by getOwn), never a value of the client", async () => {
    const otherId = "0a0b0c0d-1111-4222-8333-444455556666";
    const { log, uploadProfileImage } = harness({
      profiles: { results: [ok(anOwnProfile({ id: otherId, slug: "atelier-merel" }))] },
    });

    const result = await uploadProfileImage("logo", imageBytes("png"));

    expect(result.ok && result.value.profileId).toBe(otherId);
    expect(result.ok && result.value.slug).toBe("atelier-merel");
    expect(log.inputsOf("images", "set")).toStrictEqual([
      { kind: "logo", objectName: `${otherId}/logo-${FIXED_UUIDS[0]}.png` },
    ]);
  });

  describe("replacement", () => {
    it("criterion 1 (replace): the previous file returned by set_profile_image is removed through Storage, after the new reference is recorded", async () => {
      const { log, storage, images, uploadProfileImage } = harness({
        storage: { objects: [OLD_AVATAR] },
        images: { current: { avatar: OLD_AVATAR } },
      });
      const name = nameOf("avatar", "jpg");

      expect(await uploadProfileImage("avatar", imageBytes("jpeg"))).toStrictEqual(
        ok({ profileId: PROFILE_ID, slug: OWN_SLUG, url: urlOf(name) }),
      );
      expect(log.sequence().filter((call) => call.startsWith("storage") || call.startsWith("images"))).toStrictEqual([
        "storage.upload",
        "images.set",
        "storage.remove",
      ]);
      expect(log.inputsOf("storage", "remove")).toStrictEqual([OLD_AVATAR]);
      expect([...storage.objects]).toStrictEqual([name]);
      expect(images.current.avatar).toBe(name);
    });

    it("decision 9 (replay): set_profile_image answers the same name as the new one → nothing removed", async () => {
      const name = nameOf("avatar", "png");
      const { log, storage, uploadProfileImage } = harness({ images: { current: { avatar: name } } });

      expect(await uploadProfileImage("avatar", imageBytes("png"))).toStrictEqual(
        ok({ profileId: PROFILE_ID, slug: OWN_SLUG, url: urlOf(name) }),
      );
      expect(log.inputsOf("storage", "remove")).toStrictEqual([]);
      expect(storage.objects.has(name)).toBe(true);
    });

    it("only the previous file of the same kind is removed: the banner and the logo stay", async () => {
      const banner = `${PROFILE_ID}/banner-0f0e0d0c-0000-4000-8000-00000000000b.png`;
      const logo = `${PROFILE_ID}/logo-0f0e0d0c-0000-4000-8000-00000000000c.webp`;
      const { log, storage, uploadProfileImage } = harness({
        storage: { objects: [OLD_AVATAR, banner, logo] },
        images: { current: { avatar: OLD_AVATAR, banner, logo } },
      });

      await uploadProfileImage("avatar", imageBytes("jpeg"));

      expect(log.inputsOf("storage", "remove")).toStrictEqual([OLD_AVATAR]);
      expect([...storage.objects].sort()).toStrictEqual([nameOf("avatar", "jpg"), banner, logo].sort());
    });

    it("the removal of the previous file fails → still ok (the new reference is recorded; the old file is an orphan)", async () => {
      const { images, uploadProfileImage } = harness({
        storage: { objects: [OLD_AVATAR], removeResults: [err("unexpected")] },
        images: { current: { avatar: OLD_AVATAR } },
      });

      const result = await uploadProfileImage("avatar", imageBytes("jpeg"));

      expect(result.ok).toBe(true);
      expect(images.current.avatar).toBe(nameOf("avatar", "jpg"));
    });
  });

  describe("idempotence (docs/rules/idempotence.md)", () => {
    it("executed twice (double click): one file in the bucket, the reference of the last upload, the first file removed", async () => {
      const { log, storage, images, uploadProfileImage } = harness();
      const bytes = imageBytes("jpeg");

      const first = await uploadProfileImage("avatar", bytes);
      const second = await uploadProfileImage("avatar", bytes);

      expect(first).toStrictEqual(ok({ profileId: PROFILE_ID, slug: OWN_SLUG, url: urlOf(nameOf("avatar", "jpg", 0)) }));
      expect(second).toStrictEqual(ok({ profileId: PROFILE_ID, slug: OWN_SLUG, url: urlOf(nameOf("avatar", "jpg", 1)) }));
      expect([...storage.objects]).toStrictEqual([nameOf("avatar", "jpg", 1)]);
      expect(images.current).toStrictEqual({ avatar: nameOf("avatar", "jpg", 1), banner: null, logo: null });
      expect(log.inputsOf("storage", "remove")).toStrictEqual([nameOf("avatar", "jpg", 0)]);
    });
  });

  describe("no orphan", () => {
    it("set_profile_image refuses (not_found, a certain refusal) → the uploaded file is removed, the error is returned, the previous file is kept", async () => {
      const { log, storage, images, uploadProfileImage } = harness({
        storage: { objects: [OLD_AVATAR] },
        images: { current: { avatar: OLD_AVATAR }, failWith: "not_found" },
      });
      const name = nameOf("avatar", "png");

      expect(await uploadProfileImage("avatar", imageBytes("png"))).toStrictEqual(err("not_found"));
      expect(log.inputsOf("storage", "remove")).toStrictEqual([name]);
      expect([...storage.objects]).toStrictEqual([OLD_AVATAR]);
      expect(images.current.avatar).toBe(OLD_AVATAR);
    });

    it("decision 12: set_profile_image fails ambiguously (unexpected: it may have been recorded) → the uploaded file is NOT removed (an orphan rather than a broken reference), the error is returned", async () => {
      const { log, storage, images, uploadProfileImage } = harness({
        storage: { objects: [OLD_AVATAR] },
        images: { current: { avatar: OLD_AVATAR }, failWith: "unexpected" },
      });
      const name = nameOf("avatar", "png");

      expect(await uploadProfileImage("avatar", imageBytes("png"))).toStrictEqual(err("unexpected"));
      expect(log.inputsOf("storage", "remove")).toStrictEqual([]);
      expect([...storage.objects].sort()).toStrictEqual([OLD_AVATAR, name].sort());
      expect(images.current.avatar).toBe(OLD_AVATAR);
    });

    it("set_profile_image fails and the cleanup removal fails too → the set error is returned", async () => {
      const { uploadProfileImage } = harness({
        storage: { removeResults: [err("unexpected")] },
        images: { failWith: "not_found" },
      });

      expect(await uploadProfileImage("avatar", imageBytes("png"))).toStrictEqual(err("not_found"));
    });

    it("the upload fails → err('unexpected'), nothing recorded, nothing removed", async () => {
      const { log, images, uploadProfileImage } = harness({
        storage: { uploadResults: [err("unexpected")] },
        images: { current: { avatar: OLD_AVATAR } },
      });

      expect(await uploadProfileImage("avatar", imageBytes("png"))).toStrictEqual(err("unexpected"));
      expect(log.inputsOf("images", "set")).toStrictEqual([]);
      expect(log.inputsOf("storage", "remove")).toStrictEqual([]);
      expect(images.current.avatar).toBe(OLD_AVATAR);
    });
  });

  describe("criterion 2: refused files (nothing uploaded nor recorded)", () => {
    it.each([
      ["a text file renamed .png", textBytes("Ceci n'est pas une image"), "invalid_file"],
      ["an empty file", new Uint8Array(), "invalid_file"],
      ["an SVG", textBytes('<svg xmlns="http://www.w3.org/2000/svg"/>'), "invalid_file"],
      ["a file of 2 MiB + 1 byte", imageBytes("jpeg", 2 * 1024 * 1024 + 1), "too_large"],
      ["decision 12: a JPEG of 1501 × 10", imageBytes("jpeg", 4096, { width: 1501, height: 10 }), "invalid_file"],
      ["decision 12: a WebP of 10 × 1501", imageBytes("webp", 4096, { width: 10, height: 1501 }), "invalid_file"],
      ["decision 12: a PNG signature without IHDR", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "invalid_file"],
    ] as const)("%s → err('%s')", async (_label, bytes, error) => {
      const { log, storage, uploadProfileImage } = harness();

      expect(await uploadProfileImage("avatar", bytes)).toStrictEqual(err(error));
      expect(log.sequence()).toStrictEqual(["auth.currentUser", "rateLimiter.consume", "profiles.getOwn"]);
      expect(storage.objects.size).toBe(0);
    });

    it("a file of exactly 2 MiB is accepted", async () => {
      const { uploadProfileImage } = harness();

      expect((await uploadProfileImage("banner", imageBytes("jpeg", 2 * 1024 * 1024))).ok).toBe(true);
    });
  });

  describe("authorization (criterion 1: no other account, project nor anon)", () => {
    it("no session → err('unauthenticated'), nothing consumed, read nor uploaded", async () => {
      const { log, uploadProfileImage } = harness({ auth: { currentUser: ok(null) } });

      expect(await uploadProfileImage("avatar", imageBytes("png"))).toStrictEqual(err("unauthenticated"));
      expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
    });

    it("GoTrue unreachable → err('unexpected'), nothing uploaded", async () => {
      const { log, uploadProfileImage } = harness({ auth: { currentUser: err("unexpected") } });

      expect(await uploadProfileImage("avatar", imageBytes("png"))).toStrictEqual(err("unexpected"));
      expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
    });

    it("an account without a carnet profile (another project) → err('not_found'), nothing uploaded", async () => {
      const { log, uploadProfileImage } = harness({ profiles: { results: [ok(null)] } });

      expect(await uploadProfileImage("avatar", imageBytes("png"))).toStrictEqual(err("not_found"));
      expect(log.inputsOf("storage", "upload")).toStrictEqual([]);
    });

    it("the reader fails → err('unexpected'), nothing uploaded", async () => {
      const { log, uploadProfileImage } = harness({ profiles: { results: [err("unexpected")] } });

      expect(await uploadProfileImage("avatar", imageBytes("png"))).toStrictEqual(err("unexpected"));
      expect(log.inputsOf("storage", "upload")).toStrictEqual([]);
    });

    it("decision 4: profile-write exhausted → err('rate_limited') before any read or upload", async () => {
      const { log, uploadProfileImage } = harness({ limiter: { deny: ["profile-write"] } });

      expect(await uploadProfileImage("avatar", imageBytes("png"))).toStrictEqual(err("rate_limited"));
      expect(log.sequence()).toStrictEqual(["auth.currentUser", "rateLimiter.consume"]);
    });

    it("the limiter fails → err('unexpected') (fail closed), nothing uploaded", async () => {
      const { log, uploadProfileImage } = harness({ limiter: { failing: true } });

      expect(await uploadProfileImage("avatar", imageBytes("png"))).toStrictEqual(err("unexpected"));
      expect(log.inputsOf("storage", "upload")).toStrictEqual([]);
    });
  });
});
