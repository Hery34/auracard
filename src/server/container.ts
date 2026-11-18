import { updateTag } from "next/cache";

import { publicMediaUrl } from "@/domain/profile/profile-image";
import type { Result } from "@/domain/shared/result";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import { env } from "@/server/infrastructure/env";
import { cryptoIdGenerator } from "@/server/infrastructure/id-generator";
import { makeSupabaseMediaFolderCleaner } from "@/server/adapters/supabase-media-folder-cleaner";
import { makeMediaFetcher, MEDIA_FETCH_MAX_BYTES, MEDIA_FETCH_TIMEOUT_MS } from "@/server/adapters/media-fetcher";
import { requestClientAddress } from "@/server/infrastructure/request-client-address";
import { createAdminClient } from "@/server/infrastructure/supabase/admin";
import { makeSupabaseAuthGateway } from "@/server/infrastructure/supabase/auth-gateway";
import { createPublicSupabaseClient } from "@/server/infrastructure/supabase/public";
import { createServerSupabaseClient } from "@/server/infrastructure/supabase/server";
import { profileCacheTag } from "@/server/cache-tags";
import { makeCachedPublicProfileReader } from "@/server/repositories/cached-public-profile-reader";
import { makeSupabaseCarnetAccountEraser } from "@/server/repositories/supabase-carnet-account-eraser";
import { makeSupabaseInstanceAccountRemover } from "@/server/repositories/supabase-instance-account-remover";
import { makeSupabaseLinkRepository } from "@/server/repositories/supabase-link-repository";
import { makeSupabaseMediaStorage } from "@/server/adapters/supabase-media-storage";
import { makeSupabaseMembershipReader } from "@/server/repositories/supabase-membership-reader";
import { makeSupabaseNfcTagRepository } from "@/server/repositories/supabase-nfc-tag-repository";
import { makeSupabaseNfcTagResolver } from "@/server/repositories/supabase-nfc-tag-resolver";
import { makeSupabaseProfileImageWriter } from "@/server/repositories/supabase-profile-image-writer";
import { makeSupabaseProfileReader } from "@/server/repositories/supabase-profile-reader";
import { makeSupabaseProfileRegistrar } from "@/server/repositories/supabase-profile-registrar";
import { makeSupabaseProfileWriter } from "@/server/repositories/supabase-profile-writer";
import { makeSupabasePublicProfileReader } from "@/server/repositories/supabase-public-profile-reader";
import { makeSupabaseQrCodeRepository } from "@/server/repositories/supabase-qr-code-repository";
import { makeSupabaseQrCodeResolver } from "@/server/repositories/supabase-qr-code-resolver";
import { makeSupabaseRateLimiter } from "@/server/repositories/supabase-rate-limiter";
import { makeActivateNfcTag, type ActivateNfcTag } from "@/server/use-cases/activate-nfc-tag";
import { makeDeleteAccount, type DeleteAccount } from "@/server/use-cases/delete-account";
import { makeDownloadVCard } from "@/server/use-cases/download-vcard";
import { makeGetOwnProfile, type GetOwnProfile } from "@/server/use-cases/get-own-profile";
import { makeGetOwnQrCode, type GetOwnQrCode } from "@/server/use-cases/get-own-qr-code";
import { makeGetPublicProfile, type GetPublicProfile } from "@/server/use-cases/get-public-profile";
import { makeGetVCard, type VCardFile } from "@/server/use-cases/get-vcard";
import { makeListOwnNfcTags, type ListOwnNfcTags } from "@/server/use-cases/list-own-nfc-tags";
import { makeRegisterUser, type RegisterUser } from "@/server/use-cases/register-user";
import { makeReleaseNfcTag, type ReleaseNfcTag } from "@/server/use-cases/release-nfc-tag";
import { makeRemoveProfileImage, type RemoveProfileImage } from "@/server/use-cases/remove-profile-image";
import { makeReplaceLinks, type ReplaceLinks } from "@/server/use-cases/replace-links";
import { makeResolveNfcTag, type ResolveNfcTag } from "@/server/use-cases/resolve-nfc-tag";
import { makeResolveQrCode, type ResolveQrCode } from "@/server/use-cases/resolve-qr-code";
import { makeSaveQrStyle, type SaveQrStyle } from "@/server/use-cases/save-qr-style";
import type { RateLimitError } from "@/server/use-cases/shared/enforce-rate-limits";
import { makeSetNfcTagEnabled, type SetNfcTagEnabled } from "@/server/use-cases/set-nfc-tag-enabled";
import { makeSignIn, type SignIn } from "@/server/use-cases/sign-in";
import { makeUpdateProfile, type UpdateProfile } from "@/server/use-cases/update-profile";
import { makeUploadProfileImage, type UploadProfileImage } from "@/server/use-cases/upload-profile-image";

export type Container = {
  registerUser: RegisterUser;
  signIn: SignIn;
  getOwnProfile: GetOwnProfile;
  updateProfile: UpdateProfile;
  replaceLinks: ReplaceLinks;
  uploadProfileImage: UploadProfileImage;
  removeProfileImage: RemoveProfileImage;
  activateNfcTag: ActivateNfcTag;
  listOwnNfcTags: ListOwnNfcTags;
  setNfcTagEnabled: SetNfcTagEnabled;
  releaseNfcTag: ReleaseNfcTag;
  getOwnQrCode: GetOwnQrCode;
  saveQrStyle: SaveQrStyle;
  deleteAccount: DeleteAccount;
  qrPrintReady: boolean;
  auth: AuthGateway;
};

/** Public origin (`SITE_URL`, normalized, no trailing slash): `metadataBase` of the root layout. */
export const siteUrl: string = env.SITE_URL;

/** vCard of the route `/v/{slug}`: rate limit `vcard` on the address of the given request headers, then the file. */
export type DownloadVCardFromRequest = (slug: string, headers: Headers) => Promise<Result<VCardFile | null, RateLimitError>>;

export type PublicContainer = {
  getPublicProfile: GetPublicProfile;
  downloadVCard: DownloadVCardFromRequest;
  resolveNfcTag: ResolveNfcTag;
  resolveQrCode: ResolveQrCode;
};

/** Composition root, built once per request: the server client carries the request cookies. */
export async function createContainer(): Promise<Container> {
  const server = await createServerSupabaseClient();
  const admin = createAdminClient();

  const auth = makeSupabaseAuthGateway(server);
  const registrar = makeSupabaseProfileRegistrar(admin);
  const rateLimiter = makeSupabaseRateLimiter(admin, env.RATE_LIMIT_SECRET);
  const profiles = makeSupabaseProfileReader(server, env.NEXT_PUBLIC_SUPABASE_URL);
  const links = makeSupabaseLinkRepository(server);
  const ids = cryptoIdGenerator;
  const storage = makeSupabaseMediaStorage(server);
  const images = makeSupabaseProfileImageWriter(server);
  const membership = makeSupabaseMembershipReader(server);
  const tags = makeSupabaseNfcTagRepository(server);
  const qrCodes = makeSupabaseQrCodeRepository(server);

  return {
    auth,
    registerUser: makeRegisterUser({ auth, registrar, ids, rateLimiter }),
    signIn: makeSignIn({ auth, membership, registrar, ids, rateLimiter }),
    getOwnProfile: makeGetOwnProfile({ auth, profiles, links }),
    updateProfile: makeUpdateProfile({ auth, rateLimiter, profiles, writer: makeSupabaseProfileWriter(server) }),
    replaceLinks: makeReplaceLinks({ auth, rateLimiter, profiles, links }),
    uploadProfileImage: makeUploadProfileImage({
      auth,
      rateLimiter,
      profiles,
      storage,
      images,
      ids,
      mediaUrl: (objectName) => publicMediaUrl(env.NEXT_PUBLIC_SUPABASE_URL, objectName),
    }),
    removeProfileImage: makeRemoveProfileImage({ auth, rateLimiter, profiles, storage, images }),
    activateNfcTag: makeActivateNfcTag({ auth, membership, rateLimiter, tags }),
    listOwnNfcTags: makeListOwnNfcTags({ auth, tags }),
    setNfcTagEnabled: makeSetNfcTagEnabled({ auth, rateLimiter, profiles, tags }),
    releaseNfcTag: makeReleaseNfcTag({ auth, rateLimiter, profiles, tags }),
    getOwnQrCode: makeGetOwnQrCode({ auth, profiles, qrCodes, siteUrl: env.SITE_URL }),
    saveQrStyle: makeSaveQrStyle({ auth, rateLimiter, profiles, qrCodes }),
    deleteAccount: makeDeleteAccount({
      auth,
      rateLimiter,
      profiles,
      mediaFolder: makeSupabaseMediaFolderCleaner(server),
      carnetAccount: makeSupabaseCarnetAccountEraser(server),
      instanceAccounts: makeSupabaseInstanceAccountRemover(admin),
      profileCache: { expire: (slug) => updateTag(profileCacheTag(slug)) },
    }),
    qrPrintReady: env.QR_PRINT_READY,
  };
}

/**
 * Composition root of the public reads: no cookies, usable in static rendering. NFC and QR resolutions are read live
 * on every scan (no cache, no rate limit).
 */
export function createPublicContainer(): PublicContainer {
  const anonymous = createPublicSupabaseClient();
  const publicProfiles = makeCachedPublicProfileReader(
    makeSupabasePublicProfileReader(anonymous, env.NEXT_PUBLIC_SUPABASE_URL),
  );
  const getVCard = makeGetVCard({
    publicProfiles,
    profileUrl: (slug) => `${env.SITE_URL}/p/${slug}`,
    avatars: makeMediaFetcher({
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
      fetch: globalThis.fetch,
      timeoutMs: MEDIA_FETCH_TIMEOUT_MS,
      maxBytes: MEDIA_FETCH_MAX_BYTES,
    }),
  });
  return {
    getPublicProfile: makeGetPublicProfile({ publicProfiles }),
    downloadVCard: async (slug, headers) => {
      const downloadVCard = makeDownloadVCard({
        rateLimiter: makeSupabaseRateLimiter(createAdminClient(), env.RATE_LIMIT_SECRET),
        getVCard,
      });
      return downloadVCard({ slug, clientAddress: requestClientAddress(headers) });
    },
    resolveNfcTag: makeResolveNfcTag({ tags: makeSupabaseNfcTagResolver(anonymous) }),
    resolveQrCode: makeResolveQrCode({ codes: makeSupabaseQrCodeResolver(anonymous) }),
  };
}
