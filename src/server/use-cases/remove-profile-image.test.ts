/**
 * Contract frozen by test-engineer (0021, decisions 4, 5, 8 and 9). Ports: see upload-profile-image.test.ts.
 *
 * // src/server/use-cases/remove-profile-image.ts
 * export type RemoveProfileImageError = "unauthenticated" | "not_found" | "rate_limited" | "unexpected";
 * export type RemoveProfileImage = (kind: ProfileImageKind) =>
 *   Promise<Result<{ profileId: string; slug: string }, RemoveProfileImageError>>;
 * export function makeRemoveProfileImage(deps: {
 *   auth: AuthGateway; rateLimiter: RateLimiter; profiles: ProfileReader; storage: MediaStorage; images: ProfileImageWriter;
 * }): RemoveProfileImage;
 * // Order: authorizeProfileWrite (auth.currentUser → rateLimiter.consume("profile-write") → profiles.getOwn)
 * //   → images.set(kind, null) → previous !== null ? storage.remove(previous) : nothing → ok({ profileId, slug }).
 * // set failure → its error, nothing removed. A failed removal of the previous file never changes the result.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeRemoveProfileImage } from "@/server/use-cases/remove-profile-image";

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

const OWN_SLUG = anOwnProfile().slug;
const AUTHENTICATED = ok({ userId: GATEWAY_USER_ID, email: GATEWAY_USER_EMAIL });
const PROFILE_WRITE_CONSUME = { scope: "profile-write", subject: GATEWAY_USER_ID, limit: 60, windowSeconds: 3600 };
const AVATAR = `${PROFILE_ID}/avatar-0f0e0d0c-0000-4000-8000-00000000000a.jpg`;
const BANNER = `${PROFILE_ID}/banner-0f0e0d0c-0000-4000-8000-00000000000b.png`;
const LOGO = `${PROFILE_ID}/logo-0f0e0d0c-0000-4000-8000-00000000000c.webp`;

function harness(
  overrides: {
    auth?: FakeAuthGatewayOptions;
    limiter?: FakeRateLimiterOptions;
    profiles?: FakeProfileReaderOptions;
    storage?: FakeMediaStorageOptions;
    images?: FakeProfileImageWriterOptions;
  } = {},
) {
  const log = makeCallLog();
  const storage = fakeMediaStorage({ log, objects: [AVATAR, BANNER, LOGO], ...overrides.storage });
  const images = fakeProfileImageWriter({
    log,
    current: { avatar: AVATAR, banner: BANNER, logo: LOGO },
    ...overrides.images,
  });
  const removeProfileImage = makeRemoveProfileImage({
    auth: fakeAuthGateway({ log, currentUser: AUTHENTICATED, ...overrides.auth }),
    rateLimiter: fakeRateLimiter({ log, ...overrides.limiter }),
    profiles: fakeProfileReader({ log, ...overrides.profiles }),
    storage,
    images,
  });

  return { log, storage, images, removeProfileImage };
}

describe("removeProfileImage", () => {
  it("criterion 1 (removal): session → profile-write → own profile → set_profile_image(kind, null) → removal of the previous file → ok({ profileId, slug })", async () => {
    const { log, storage, images, removeProfileImage } = harness();

    expect(await removeProfileImage("avatar")).toStrictEqual(ok({ profileId: PROFILE_ID, slug: OWN_SLUG }));
    expect(log.sequence()).toStrictEqual([
      "auth.currentUser",
      "rateLimiter.consume",
      "profiles.getOwn",
      "images.set",
      "storage.remove",
    ]);
    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([PROFILE_WRITE_CONSUME]);
    expect(log.inputsOf("images", "set")).toStrictEqual([{ kind: "avatar", objectName: null }]);
    expect(log.inputsOf("storage", "remove")).toStrictEqual([AVATAR]);
    expect(images.current).toStrictEqual({ avatar: null, banner: BANNER, logo: LOGO });
    expect([...storage.objects].sort()).toStrictEqual([BANNER, LOGO].sort());
  });

  it.each([
    ["banner", BANNER],
    ["logo", LOGO],
  ] as const)("%s: only that kind is cleared and its file removed", async (kind, objectName) => {
    const { log, images, removeProfileImage } = harness();

    await removeProfileImage(kind);

    expect(log.inputsOf("images", "set")).toStrictEqual([{ kind, objectName: null }]);
    expect(log.inputsOf("storage", "remove")).toStrictEqual([objectName]);
    expect(images.current[kind]).toBeNull();
    expect(images.current.avatar).toBe(AVATAR);
  });

  it("no image of that kind (previous null) → ok, nothing removed", async () => {
    const { log, removeProfileImage } = harness({ images: { current: { avatar: null } } });

    expect(await removeProfileImage("avatar")).toStrictEqual(ok({ profileId: PROFILE_ID, slug: OWN_SLUG }));
    expect(log.inputsOf("storage", "remove")).toStrictEqual([]);
  });

  it("idempotence: executed twice → same final state, the second call removes nothing", async () => {
    const { log, storage, images, removeProfileImage } = harness();

    const first = await removeProfileImage("avatar");
    const second = await removeProfileImage("avatar");

    expect(first).toStrictEqual(ok({ profileId: PROFILE_ID, slug: OWN_SLUG }));
    expect(second).toStrictEqual(first);
    expect(log.inputsOf("storage", "remove")).toStrictEqual([AVATAR]);
    expect(images.current.avatar).toBeNull();
    expect(storage.objects.has(AVATAR)).toBe(false);
  });

  it.each(["not_found", "unexpected"] as const)("set_profile_image fails (%s) → that error, nothing removed", async (error) => {
    const { log, storage, removeProfileImage } = harness({ images: { failWith: error } });

    expect(await removeProfileImage("avatar")).toStrictEqual(err(error));
    expect(log.inputsOf("storage", "remove")).toStrictEqual([]);
    expect(storage.objects.has(AVATAR)).toBe(true);
  });

  it("the removal of the previous file fails → still ok (the reference is cleared)", async () => {
    const { images, removeProfileImage } = harness({ storage: { removeResults: [err("unexpected")] } });

    expect(await removeProfileImage("avatar")).toStrictEqual(ok({ profileId: PROFILE_ID, slug: OWN_SLUG }));
    expect(images.current.avatar).toBeNull();
  });

  describe("authorization", () => {
    it("no session → err('unauthenticated'), nothing cleared", async () => {
      const { log, removeProfileImage } = harness({ auth: { currentUser: ok(null) } });

      expect(await removeProfileImage("avatar")).toStrictEqual(err("unauthenticated"));
      expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
    });

    it("GoTrue unreachable → err('unexpected')", async () => {
      const { log, removeProfileImage } = harness({ auth: { currentUser: err("unexpected") } });

      expect(await removeProfileImage("avatar")).toStrictEqual(err("unexpected"));
      expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
    });

    it("an account of another project (no carnet profile) → err('not_found'), nothing cleared", async () => {
      const { log, removeProfileImage } = harness({ profiles: { results: [ok(null)] } });

      expect(await removeProfileImage("avatar")).toStrictEqual(err("not_found"));
      expect(log.inputsOf("images", "set")).toStrictEqual([]);
      expect(log.inputsOf("storage", "remove")).toStrictEqual([]);
    });

    it("profile-write exhausted → err('rate_limited') before any read", async () => {
      const { log, removeProfileImage } = harness({ limiter: { deny: ["profile-write"] } });

      expect(await removeProfileImage("avatar")).toStrictEqual(err("rate_limited"));
      expect(log.sequence()).toStrictEqual(["auth.currentUser", "rateLimiter.consume"]);
    });
  });
});
