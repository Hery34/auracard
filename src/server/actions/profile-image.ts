"use server";

import { updateTag } from "next/cache";

import { isProfileImageKind, PROFILE_IMAGE_MAX_BYTES } from "@/domain/profile/profile-image";
import { profileCacheTag } from "@/server/cache-tags";
import { createContainer } from "@/server/container";
import type { UploadProfileImageError } from "@/server/use-cases/upload-profile-image";

export type ProfileImageActionError = "invalid_input" | UploadProfileImageError;

export type ProfileImageState =
  | { status: "idle" }
  | { status: "error"; error: ProfileImageActionError }
  | { status: "saved"; url: string | null };

/**
 * Fields `kind` and `file` (re-encoded by the browser). Only the bytes reach the use case: the file name and declared
 * type are never used. Session, rate limit, ownership and real type are checked by the use case.
 */
export async function uploadProfileImageAction(
  _previous: ProfileImageState,
  formData: FormData,
): Promise<ProfileImageState> {
  const kind = formData.get("kind");
  const file = formData.get("file");
  if (!isProfileImageKind(kind) || !(file instanceof File)) {
    return { status: "error", error: "invalid_input" };
  }
  if (file.size > PROFILE_IMAGE_MAX_BYTES) {
    return { status: "error", error: "too_large" };
  }
  const { uploadProfileImage } = await createContainer();
  const result = await uploadProfileImage(kind, new Uint8Array(await file.arrayBuffer()));
  if (!result.ok) {
    return { status: "error", error: result.error };
  }
  updateTag(profileCacheTag(result.value.slug));
  return { status: "saved", url: result.value.url };
}

/** Field `kind`. */
export async function removeProfileImageAction(
  _previous: ProfileImageState,
  formData: FormData,
): Promise<ProfileImageState> {
  const kind = formData.get("kind");
  if (!isProfileImageKind(kind)) {
    return { status: "error", error: "invalid_input" };
  }
  const { removeProfileImage } = await createContainer();
  const result = await removeProfileImage(kind);
  if (!result.ok) {
    return { status: "error", error: result.error };
  }
  updateTag(profileCacheTag(result.value.slug));
  return { status: "saved", url: null };
}
