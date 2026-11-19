import { updateTag } from "next/cache";

import type { ServerEventType } from "@/domain/analytics/analytics-event";
import type { Slot } from "@/domain/booking/slots";
import { publicMediaUrl } from "@/domain/profile/profile-image";
import type { Result } from "@/domain/shared/result";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import { env } from "@/server/infrastructure/env";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import { cryptoIdGenerator } from "@/server/infrastructure/id-generator";
import { makeSupabaseMediaFolderCleaner } from "@/server/adapters/supabase-media-folder-cleaner";
import { makeMediaFetcher, MEDIA_FETCH_MAX_BYTES, MEDIA_FETCH_TIMEOUT_MS } from "@/server/adapters/media-fetcher";
import { makeTurnstileVerifier, TURNSTILE_TIMEOUT_MS } from "@/server/adapters/turnstile";
import { requestClientAddress } from "@/server/infrastructure/request-client-address";
import { createAdminClient } from "@/server/infrastructure/supabase/admin";
import { makeSupabaseAuthGateway } from "@/server/infrastructure/supabase/auth-gateway";
import { createPublicSupabaseClient } from "@/server/infrastructure/supabase/public";
import { createServerSupabaseClient } from "@/server/infrastructure/supabase/server";
import { makeCachedPublicBookingReader } from "@/server/booking/repositories/cached-public-booking-reader";
import { makeSupabaseAvailabilityRepository } from "@/server/booking/repositories/supabase-availability-repository";
import { makeSupabaseEventTypeRepository } from "@/server/booking/repositories/supabase-event-type-repository";
import { makeSupabasePublicBookingReader } from "@/server/booking/repositories/supabase-public-booking-reader";
import { makeSupabaseSlotBooker } from "@/server/booking/repositories/supabase-slot-booker";
import {
  makeAddAvailabilityException,
  type AddAvailabilityException,
} from "@/server/booking/use-cases/add-availability-exception";
import { makeBookSlot, type BookSlotError, type BookSlotInput } from "@/server/booking/use-cases/book-slot";
import { makeCreateEventType, type CreateEventType } from "@/server/booking/use-cases/create-event-type";
import { makeDeleteEventType, type DeleteEventType } from "@/server/booking/use-cases/delete-event-type";
import { makeGetBookingSettings, type GetBookingSettings } from "@/server/booking/use-cases/get-booking-settings";
import {
  makeGetPublicBookingPage,
  type GetPublicBookingPage,
} from "@/server/booking/use-cases/get-public-booking-page";
import {
  makeListPublicSlots,
  type ListPublicSlotsError,
  type ListPublicSlotsInput,
} from "@/server/booking/use-cases/list-public-slots";
import {
  makeRemoveAvailabilityException,
  type RemoveAvailabilityException,
} from "@/server/booking/use-cases/remove-availability-exception";
import { makeReorderEventTypes, type ReorderEventTypes } from "@/server/booking/use-cases/reorder-event-types";
import {
  makeReplaceAvailabilityRules,
  type ReplaceAvailabilityRules,
} from "@/server/booking/use-cases/replace-availability-rules";
import { makeSaveTimeZone, type SaveTimeZone } from "@/server/booking/use-cases/save-time-zone";
import { makeSetEventTypeActive, type SetEventTypeActive } from "@/server/booking/use-cases/set-event-type-active";
import { makeUpdateEventType, type UpdateEventType } from "@/server/booking/use-cases/update-event-type";
import { profileCacheTag } from "@/server/cache-tags";
import { makeCachedPublicProfileReader } from "@/server/repositories/cached-public-profile-reader";
import { makeSupabaseEventRecorder } from "@/server/repositories/supabase-event-recorder";
import { makeSupabaseDailyAggregateReader } from "@/server/repositories/supabase-daily-aggregate-reader";
import { makeSupabaseCarnetAccountEraser } from "@/server/repositories/supabase-carnet-account-eraser";
import { makeSupabaseInstanceAccountRemover } from "@/server/repositories/supabase-instance-account-remover";
import { makeSupabaseLeadCapturer } from "@/server/repositories/supabase-lead-capturer";
import { makeSupabaseLeadRepository } from "@/server/repositories/supabase-lead-repository";
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
import { makeCaptureLead, type CaptureLeadError, type CaptureLeadInput } from "@/server/use-cases/capture-lead";
import { makeDeleteAccount, type DeleteAccount } from "@/server/use-cases/delete-account";
import { makeDeleteOwnLead, type DeleteOwnLead } from "@/server/use-cases/delete-own-lead";
import { makeDownloadVCard } from "@/server/use-cases/download-vcard";
import { makeGetOwnProfile, type GetOwnProfile } from "@/server/use-cases/get-own-profile";
import { makeGetOwnQrCode, type GetOwnQrCode } from "@/server/use-cases/get-own-qr-code";
import { makeGetOwnStats, type GetOwnStats } from "@/server/use-cases/get-own-stats";
import { makeGetPublicProfile, type GetPublicProfile } from "@/server/use-cases/get-public-profile";
import { makeGetVCard, type VCardFile } from "@/server/use-cases/get-vcard";
import {
  makeRecordBeaconEvent,
  makeRecordServerEvent,
  type BeaconInput,
  type RecordOutcome,
} from "@/server/use-cases/record-event";
import { makeListOwnLeads, type ListOwnLeads } from "@/server/use-cases/list-own-leads";
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
  getOwnStats: GetOwnStats;
  listOwnLeads: ListOwnLeads;
  deleteOwnLead: DeleteOwnLead;
  deleteAccount: DeleteAccount;
  getBookingSettings: GetBookingSettings;
  saveTimeZone: SaveTimeZone;
  createEventType: CreateEventType;
  updateEventType: UpdateEventType;
  setEventTypeActive: SetEventTypeActive;
  reorderEventTypes: ReorderEventTypes;
  deleteEventType: DeleteEventType;
  replaceAvailabilityRules: ReplaceAvailabilityRules;
  addAvailabilityException: AddAvailabilityException;
  removeAvailabilityException: RemoveAvailabilityException;
  qrPrintReady: boolean;
  auth: AuthGateway;
};

/** Public origin (`SITE_URL`, normalized, no trailing slash): `metadataBase` of the root layout. */
export const siteUrl: string = env.SITE_URL;

/** Public key of the Turnstile widget, read by the public page. */
export const turnstileSiteKey: string = env.TURNSTILE_SITE_KEY;

/** vCard of the route `/v/{slug}`: rate limit `vcard` on the address of the given request headers, then the file. */
export type DownloadVCardFromRequest = (slug: string, headers: Headers) => Promise<Result<VCardFile | null, RateLimitError>>;

/** Event of `/api/beacon`, as validated by the route; the use case checks it again. */
export type BeaconEvent = Omit<BeaconInput, "userAgent" | "clientAddress">;

/** User-agent and address read from the given request headers. */
export type RecordBeaconFromRequest = (
  event: BeaconEvent,
  headers: Headers,
) => Promise<Result<RecordOutcome, "unexpected">>;

export type RecordServerEventFromRequest = (
  event: { slug: string; type: ServerEventType },
  headers: Headers,
) => Promise<Result<RecordOutcome, "unexpected">>;

/** User-agent and address read from the given request headers. */
export type CaptureLeadFromRequest = (
  input: Omit<CaptureLeadInput, "userAgent" | "clientAddress">,
  headers: Headers,
) => Promise<Result<{ leadId: string }, CaptureLeadError>>;

/** Address read from the given request headers. */
export type ListPublicSlotsFromRequest = (
  input: Omit<ListPublicSlotsInput, "clientAddress">,
  headers: Headers,
) => Promise<Result<readonly Slot[], ListPublicSlotsError>>;

/** User-agent and address read from the given request headers. */
export type BookSlotFromRequest = (
  input: Omit<BookSlotInput, "userAgent" | "clientAddress">,
  headers: Headers,
) => Promise<Result<{ bookingId: string }, BookSlotError>>;

export type PublicContainer = {
  getPublicProfile: GetPublicProfile;
  downloadVCard: DownloadVCardFromRequest;
  resolveNfcTag: ResolveNfcTag;
  resolveQrCode: ResolveQrCode;
  recordBeaconEvent: RecordBeaconFromRequest;
  recordServerEvent: RecordServerEventFromRequest;
  captureLead: CaptureLeadFromRequest;
  getPublicBookingPage: GetPublicBookingPage;
  listPublicSlots: ListPublicSlotsFromRequest;
  bookSlot: BookSlotFromRequest;
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
  const leads = makeSupabaseLeadRepository(server);
  const eventTypes = makeSupabaseEventTypeRepository(server);
  const availability = makeSupabaseAvailabilityRepository(server);
  const clock = { now: () => new Date() };

  /**
   * The public booking page (types, rules, time zone) is cached under the profile's tag: a successful settings write
   * expires it, read-your-own-writes, and so does the « Prendre rendez-vous » link of /p/{slug}. A failed re-read of
   * the profile leaves the cache to expire on its own: logged, the write still succeeds.
   */
  function expiringProfileCache<A, T, E>(useCase: (input: A) => Promise<Result<T, E>>): (input: A) => Promise<Result<T, E>> {
    return async (input) => {
      const result = await useCase(input);
      if (result.ok) {
        const own = await profiles.getOwn();
        if (!own.ok) {
          logInfrastructureError("profile_cache_expiry", own.error);
        } else if (own.value !== null) {
          updateTag(profileCacheTag(own.value.slug));
        }
      }
      return result;
    };
  }

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
    getOwnStats: makeGetOwnStats({
      auth,
      profiles,
      links,
      aggregates: makeSupabaseDailyAggregateReader(server),
      clock: { now: () => new Date() },
    }),
    listOwnLeads: makeListOwnLeads({ auth, profiles, leads }),
    deleteOwnLead: makeDeleteOwnLead({ auth, rateLimiter, profiles, leads }),
    deleteAccount: makeDeleteAccount({
      auth,
      rateLimiter,
      profiles,
      mediaFolder: makeSupabaseMediaFolderCleaner(server),
      carnetAccount: makeSupabaseCarnetAccountEraser(server),
      instanceAccounts: makeSupabaseInstanceAccountRemover(admin),
      profileCache: { expire: (slug) => updateTag(profileCacheTag(slug)) },
    }),
    getBookingSettings: makeGetBookingSettings({ auth, profiles, eventTypes, availability, clock }),
    saveTimeZone: expiringProfileCache(makeSaveTimeZone({ auth, rateLimiter, profiles, availability })),
    createEventType: expiringProfileCache(makeCreateEventType({ auth, rateLimiter, profiles, eventTypes })),
    updateEventType: expiringProfileCache(makeUpdateEventType({ auth, rateLimiter, profiles, eventTypes })),
    setEventTypeActive: expiringProfileCache(makeSetEventTypeActive({ auth, rateLimiter, profiles, eventTypes })),
    reorderEventTypes: expiringProfileCache(makeReorderEventTypes({ auth, rateLimiter, profiles, eventTypes })),
    deleteEventType: expiringProfileCache(makeDeleteEventType({ auth, rateLimiter, profiles, eventTypes })),
    replaceAvailabilityRules: expiringProfileCache(
      makeReplaceAvailabilityRules({ auth, rateLimiter, profiles, availability }),
    ),
    addAvailabilityException: makeAddAvailabilityException({ auth, rateLimiter, profiles, availability, clock }),
    removeAvailabilityException: makeRemoveAvailabilityException({ auth, rateLimiter, profiles, availability }),
    qrPrintReady: env.QR_PRINT_READY,
  };
}

function turnstileVerifier() {
  return makeTurnstileVerifier({
    secretKey: env.TURNSTILE_SECRET_KEY,
    fetch: globalThis.fetch,
    timeoutMs: TURNSTILE_TIMEOUT_MS,
  });
}

function visitorOf(headers: Headers): { userAgent: string | null; clientAddress: string } {
  return { userAgent: headers.get("user-agent"), clientAddress: requestClientAddress(headers) };
}

/**
 * Composition root of the public reads: no cookies, usable in static rendering. NFC and QR resolutions are read live
 * on every scan (no cache, no rate limit). The service_role client is created on demand, by the recordings, the
 * vCard rate limit, the contact form, the slot list's rate limit and the booking only.
 */
export function createPublicContainer(): PublicContainer {
  const anonymous = createPublicSupabaseClient();
  const publicProfiles = makeCachedPublicProfileReader(
    makeSupabasePublicProfileReader(anonymous, env.NEXT_PUBLIC_SUPABASE_URL),
  );
  const bookingPages = makeSupabasePublicBookingReader(anonymous);
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
    recordBeaconEvent: async (event, headers) => {
      const admin = createAdminClient();
      const recordBeaconEvent = makeRecordBeaconEvent({
        rateLimiter: makeSupabaseRateLimiter(admin, env.RATE_LIMIT_SECRET),
        events: makeSupabaseEventRecorder(admin),
      });
      return recordBeaconEvent({ ...event, ...visitorOf(headers) });
    },
    recordServerEvent: async (event, headers) => {
      const admin = createAdminClient();
      const recordServerEvent = makeRecordServerEvent({
        ids: cryptoIdGenerator,
        rateLimiter: makeSupabaseRateLimiter(admin, env.RATE_LIMIT_SECRET),
        events: makeSupabaseEventRecorder(admin),
      });
      return recordServerEvent({ ...event, ...visitorOf(headers) });
    },
    captureLead: async (input, headers) => {
      const admin = createAdminClient();
      const captureLead = makeCaptureLead({
        rateLimiter: makeSupabaseRateLimiter(admin, env.RATE_LIMIT_SECRET),
        challenge: turnstileVerifier(),
        leads: makeSupabaseLeadCapturer(admin),
      });
      return captureLead({ ...input, ...visitorOf(headers) });
    },
    getPublicBookingPage: makeGetPublicBookingPage({ pages: makeCachedPublicBookingReader(bookingPages) }),
    listPublicSlots: async (input, headers) => {
      const listPublicSlots = makeListPublicSlots({
        rateLimiter: makeSupabaseRateLimiter(createAdminClient(), env.RATE_LIMIT_SECRET),
        pages: bookingPages,
        clock: { now: () => new Date() },
      });
      return listPublicSlots({ ...input, clientAddress: requestClientAddress(headers) });
    },
    bookSlot: async (input, headers) => {
      const admin = createAdminClient();
      const bookSlot = makeBookSlot({
        rateLimiter: makeSupabaseRateLimiter(admin, env.RATE_LIMIT_SECRET),
        challenge: turnstileVerifier(),
        bookings: makeSupabaseSlotBooker(admin),
      });
      return bookSlot({ ...input, ...visitorOf(headers) });
    },
  };
}
