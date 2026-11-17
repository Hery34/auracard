import type { MediaStorage, ProfileImageWriter, ProfileReader } from "@/domain/profile/ports";
import {
  IMAGE_FORMATS,
  profileImageObjectName,
  validateProfileImage,
  type ProfileImageKind,
} from "@/domain/profile/profile-image";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { IdGenerator } from "@/domain/shared/ports/id-generator";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, ok, type Result } from "@/domain/shared/result";
import { authorizeProfileWrite } from "@/server/use-cases/shared/authorize-profile-write";

export type UploadProfileImageError =
  | "unauthenticated"
  | "not_found"
  | "rate_limited"
  | "invalid_file"
  | "too_large"
  | "unexpected";

export type UploadProfileImage = (
  kind: ProfileImageKind,
  bytes: Uint8Array,
) => Promise<Result<{ profileId: string; slug: string; url: string | null }, UploadProfileImageError>>;

/**
 * Uploads under a new unpredictable name, then records the reference; the previous file of that kind is removed
 * afterwards. A failed removal leaves an orphan, never a failure (ADR 0014: periodic purge). The uploaded file is
 * removed only on a certain refusal of `set` (`not_found`): an ambiguous failure may have recorded it.
 */
export function makeUploadProfileImage(deps: {
  auth: AuthGateway;
  rateLimiter: RateLimiter;
  profiles: ProfileReader;
  storage: MediaStorage;
  images: ProfileImageWriter;
  ids: IdGenerator;
  mediaUrl: (objectName: string) => string | null;
}): UploadProfileImage {
  return async (kind, bytes) => {
    const authorized = await authorizeProfileWrite(deps);
    if (!authorized.ok) {
      return err(authorized.error);
    }
    const { profileId, slug } = authorized.value;
    const format = validateProfileImage(bytes);
    if (!format.ok) {
      return err(format.error);
    }
    const objectName = profileImageObjectName({ profileId, kind, uuid: deps.ids.uuid(), format: format.value });
    const uploaded = await deps.storage.upload({ objectName, bytes, contentType: IMAGE_FORMATS[format.value].contentType });
    if (!uploaded.ok) {
      return err("unexpected");
    }
    const recorded = await deps.images.set(kind, objectName);
    if (!recorded.ok) {
      if (recorded.error === "not_found") {
        await deps.storage.remove(objectName);
      }
      return err(recorded.error);
    }
    const { previous } = recorded.value;
    if (previous !== null && previous !== objectName) {
      await deps.storage.remove(previous);
    }
    return ok({ profileId, slug, url: deps.mediaUrl(objectName) });
  };
}
