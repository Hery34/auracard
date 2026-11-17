/**
 * Contract frozen by test-engineer (0021, decisions 4, 8 and 9).
 *
 * // src/server/actions/profile-image.ts — "use server"
 * export type ProfileImageActionError = "invalid_input" | UploadProfileImageError;
 * export type ProfileImageState =
 *   | { status: "idle" }
 *   | { status: "error"; error: ProfileImageActionError }
 *   | { status: "saved"; url: string | null };          // url: public URL of the new image, null after a removal
 *
 * // Fields: `kind` ("avatar" | "banner" | "logo") and `file` (the File re-encoded by the browser).
 * export async function uploadProfileImageAction(previous: ProfileImageState, formData: FormData): Promise<ProfileImageState>;
 * // Field: `kind`.
 * export async function removeProfileImageAction(previous: ProfileImageState, formData: FormData): Promise<ProfileImageState>;
 *
 * // Chain: validate before createContainer (kind ∈ PROFILE_IMAGE_KINDS and `file` a File, else invalid_input;
 * // file.size > PROFILE_IMAGE_MAX_BYTES → too_large without reading it) → use case with the bytes of the file
 * // (new Uint8Array(await file.arrayBuffer())); the file name and declared type are never used
 * // → map Result as is → on success only: updateTag(profileCacheTag(slug)).
 * // No submitted value (file name, type, kind, bytes) in the returned state.
 * // src/server/container.ts — Container gains `uploadProfileImage: UploadProfileImage` and
 * // `removeProfileImage: RemoveProfileImage`. next.config.ts: experimental.serverActions.bodySizeLimit = "3mb".
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import type { ProfileImageState } from "@/server/actions/profile-image";

import { stubValidEnv } from "../../../tests/builders/env";
import { PROFILE_ID } from "../../../tests/builders/fake-registrar";
import { anImageFile, imageBytes, textBytes } from "../../../tests/builders/images";

const mocks = vi.hoisted(() => ({
  createContainer: vi.fn(),
  uploadProfileImage: vi.fn(),
  removeProfileImage: vi.fn(),
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
  profileCacheTag: vi.fn(),
}));

vi.mock("@/server/cache-tags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/cache-tags")>();
  mocks.profileCacheTag.mockImplementation(actual.profileCacheTag);
  return { profileCacheTag: mocks.profileCacheTag };
});

vi.mock("@/server/container", () => ({ createContainer: mocks.createContainer }));

vi.mock("next/cache", () => ({
  revalidateTag: mocks.revalidateTag,
  updateTag: mocks.updateTag,
  revalidatePath: vi.fn(),
}));

const SLUG = "elodie-durand-merel";
const URL_OF_NEW_IMAGE = `https://supabase.carnet.example/storage/v1/object/public/carnet-media/${PROFILE_ID}/avatar-1a2b3c4d-0000-4000-8000-000000000001.png`;
const MAX_BYTES = 2 * 1024 * 1024;
const UPLOAD_ERRORS = ["unauthenticated", "not_found", "rate_limited", "invalid_file", "too_large", "unexpected"] as const;
const REMOVE_ERRORS = ["unauthenticated", "not_found", "rate_limited", "unexpected"] as const;
/** A file name and a declared type a client could choose: never reflected, never used. */
const HOSTILE_NAME = '<img src=x onerror=alert(1)>.png';

const idle: ProfileImageState = { status: "idle" };

function form(fields: Record<string, string | File | undefined>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) {
      data.set(name, value);
    }
  }
  return data;
}

function updatedTags(): unknown[] {
  return mocks.updateTag.mock.calls.map(([tag]) => tag);
}

let actions: typeof import("@/server/actions/profile-image");

beforeAll(async () => {
  stubValidEnv();
  actions = await import("@/server/actions/profile-image");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createContainer.mockImplementation(async () => ({
    uploadProfileImage: mocks.uploadProfileImage,
    removeProfileImage: mocks.removeProfileImage,
  }));
  mocks.uploadProfileImage.mockResolvedValue(ok({ profileId: PROFILE_ID, slug: SLUG, url: URL_OF_NEW_IMAGE }));
  mocks.removeProfileImage.mockResolvedValue(ok({ profileId: PROFILE_ID, slug: SLUG }));
});

describe("uploadProfileImageAction", () => {
  it("criterion 1: calls uploadProfileImage(kind, bytes of the file) → { status: 'saved', url }, then updateTag('profile:<slug>')", async () => {
    const bytes = imageBytes("png", 4096);

    expect(await actions.uploadProfileImageAction(idle, form({ kind: "avatar", file: anImageFile(bytes, "moi.png", "image/png") }))).toStrictEqual({
      status: "saved",
      url: URL_OF_NEW_IMAGE,
    });

    expect(mocks.uploadProfileImage).toHaveBeenCalledTimes(1);
    const [kind, received] = mocks.uploadProfileImage.mock.calls[0] as [string, Uint8Array];
    expect(kind).toBe("avatar");
    expect(received).toBeInstanceOf(Uint8Array);
    expect([...received]).toStrictEqual([...bytes]);
    expect(updatedTags()).toStrictEqual([`profile:${SLUG}`]);
    expect(mocks.profileCacheTag).toHaveBeenCalledWith(SLUG);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it.each(["avatar", "banner", "logo"])("decision 1: kind %s is accepted", async (kind) => {
    await actions.uploadProfileImageAction(idle, form({ kind, file: anImageFile(imageBytes("jpeg")) }));

    expect(mocks.uploadProfileImage).toHaveBeenCalledWith(kind, expect.any(Uint8Array));
  });

  it.each([
    ["an unknown kind", { kind: "photo" }],
    ["an upper-case kind", { kind: "Avatar" }],
    ["no kind", { kind: undefined }],
  ])("%s → invalid_input before the container, nothing invalidated", async (_label, fields) => {
    const state = await actions.uploadProfileImageAction(idle, form({ ...fields, file: anImageFile(imageBytes("png")) }));

    expect(state).toStrictEqual({ status: "error", error: "invalid_input" });
    expect(mocks.createContainer).not.toHaveBeenCalled();
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it.each([
    ["no file", undefined],
    ["a text field instead of a file", "data:image/png;base64,iVBORw0KGgo="],
  ])("%s → invalid_input before the container", async (_label, file) => {
    expect(await actions.uploadProfileImageAction(idle, form({ kind: "avatar", file }))).toStrictEqual({
      status: "error",
      error: "invalid_input",
    });
    expect(mocks.createContainer).not.toHaveBeenCalled();
  });

  it("criterion 2: a file over 2 MiB → too_large before the container (never read)", async () => {
    const state = await actions.uploadProfileImageAction(
      idle,
      form({ kind: "avatar", file: anImageFile(imageBytes("jpeg", MAX_BYTES + 1)) }),
    );

    expect(state).toStrictEqual({ status: "error", error: "too_large" });
    expect(mocks.createContainer).not.toHaveBeenCalled();
  });

  it("criterion 2: a text file renamed .png and declared image/png reaches the use case as bytes; its answer is returned", async () => {
    const bytes = textBytes("Ceci n'est pas une image");
    mocks.uploadProfileImage.mockResolvedValue(err("invalid_file"));

    const state = await actions.uploadProfileImageAction(
      idle,
      form({ kind: "avatar", file: anImageFile(bytes, "faux.png", "image/png") }),
    );

    expect(state).toStrictEqual({ status: "error", error: "invalid_file" });
    expect([...(mocks.uploadProfileImage.mock.calls[0]?.[1] as Uint8Array)]).toStrictEqual([...bytes]);
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it.each(UPLOAD_ERRORS)("use case error %s → { status: 'error', error } as is, no updateTag", async (error) => {
    mocks.uploadProfileImage.mockResolvedValue(err(error));

    expect(await actions.uploadProfileImageAction(idle, form({ kind: "avatar", file: anImageFile(imageBytes("png")) }))).toStrictEqual({
      status: "error",
      error,
    });
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("no submitted value in the returned state: neither the file name, nor its type, nor the kind", async () => {
    mocks.uploadProfileImage.mockResolvedValue(err("invalid_file"));
    const file = anImageFile(textBytes("SECRET-CONTENT"), HOSTILE_NAME, "image/x-SECRET-TYPE");

    const states = [
      await actions.uploadProfileImageAction(idle, form({ kind: "avatar", file })),
      await actions.uploadProfileImageAction(idle, form({ kind: "SECRET-KIND", file })),
    ];

    for (const state of states) {
      const serialized = JSON.stringify(state);
      expect(serialized).not.toContain("onerror");
      expect(serialized).not.toContain("SECRET");
      expect(serialized).not.toContain("avatar");
    }
  });

  it("idempotence: submitted twice → two use case calls (the use case keeps one file), one updateTag per success", async () => {
    const data = () => form({ kind: "avatar", file: anImageFile(imageBytes("png")) });

    await actions.uploadProfileImageAction(idle, data());
    await actions.uploadProfileImageAction(idle, data());

    expect(mocks.uploadProfileImage).toHaveBeenCalledTimes(2);
    expect(updatedTags()).toStrictEqual([`profile:${SLUG}`, `profile:${SLUG}`]);
  });
});

describe("removeProfileImageAction", () => {
  it("criterion 1: calls removeProfileImage(kind) → { status: 'saved', url: null }, then updateTag('profile:<slug>')", async () => {
    expect(await actions.removeProfileImageAction(idle, form({ kind: "banner" }))).toStrictEqual({
      status: "saved",
      url: null,
    });

    expect(mocks.removeProfileImage).toHaveBeenCalledWith("banner");
    expect(updatedTags()).toStrictEqual([`profile:${SLUG}`]);
    expect(mocks.profileCacheTag).toHaveBeenCalledWith(SLUG);
  });

  it.each([["photo"], [""], [undefined]])("kind %j → invalid_input before the container", async (kind) => {
    expect(await actions.removeProfileImageAction(idle, form({ kind }))).toStrictEqual({
      status: "error",
      error: "invalid_input",
    });
    expect(mocks.createContainer).not.toHaveBeenCalled();
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it.each(REMOVE_ERRORS)("use case error %s → { status: 'error', error } as is, no updateTag", async (error) => {
    mocks.removeProfileImage.mockResolvedValue(err(error));

    expect(await actions.removeProfileImageAction(idle, form({ kind: "logo" }))).toStrictEqual({ status: "error", error });
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("idempotence: submitted twice → same answer twice", async () => {
    const first = await actions.removeProfileImageAction(idle, form({ kind: "avatar" }));
    const second = await actions.removeProfileImageAction(idle, form({ kind: "avatar" }));

    expect(second).toStrictEqual(first);
  });
});

describe("next.config.ts (decision 4)", () => {
  it("the Server Actions body limit is raised to 3 MB (2 MiB file + form overhead)", async () => {
    const { default: config } = await import("../../../next.config");

    expect(config.experimental?.serverActions?.bodySizeLimit).toBe("3mb");
  });

  it("images.unoptimized stays true (docs/rules/nextjs.md)", async () => {
    const { default: config } = await import("../../../next.config");

    expect(config.images?.unoptimized).toBe(true);
  });
});
