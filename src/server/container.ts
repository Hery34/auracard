import type { Result } from "@/domain/shared/result";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import { env } from "@/server/infrastructure/env";
import { cryptoIdGenerator } from "@/server/infrastructure/id-generator";
import { requestClientAddress } from "@/server/infrastructure/request-client-address";
import { createAdminClient } from "@/server/infrastructure/supabase/admin";
import { makeSupabaseAuthGateway } from "@/server/infrastructure/supabase/auth-gateway";
import { createPublicSupabaseClient } from "@/server/infrastructure/supabase/public";
import { createServerSupabaseClient } from "@/server/infrastructure/supabase/server";
import { makeCachedPublicProfileReader } from "@/server/repositories/cached-public-profile-reader";
import { makeSupabaseLinkRepository } from "@/server/repositories/supabase-link-repository";
import { makeSupabaseMembershipReader } from "@/server/repositories/supabase-membership-reader";
import { makeSupabaseProfileReader } from "@/server/repositories/supabase-profile-reader";
import { makeSupabaseProfileRegistrar } from "@/server/repositories/supabase-profile-registrar";
import { makeSupabaseProfileWriter } from "@/server/repositories/supabase-profile-writer";
import { makeSupabasePublicProfileReader } from "@/server/repositories/supabase-public-profile-reader";
import { makeSupabaseRateLimiter } from "@/server/repositories/supabase-rate-limiter";
import { makeDownloadVCard } from "@/server/use-cases/download-vcard";
import { makeGetOwnProfile, type GetOwnProfile } from "@/server/use-cases/get-own-profile";
import { makeGetPublicProfile, type GetPublicProfile } from "@/server/use-cases/get-public-profile";
import { makeGetVCard, type VCardFile } from "@/server/use-cases/get-vcard";
import { makeRegisterUser, type RegisterUser } from "@/server/use-cases/register-user";
import { makeReplaceLinks, type ReplaceLinks } from "@/server/use-cases/replace-links";
import type { RateLimitError } from "@/server/use-cases/shared/enforce-rate-limits";
import { makeSignIn, type SignIn } from "@/server/use-cases/sign-in";
import { makeUpdateProfile, type UpdateProfile } from "@/server/use-cases/update-profile";

export type Container = {
  registerUser: RegisterUser;
  signIn: SignIn;
  getOwnProfile: GetOwnProfile;
  updateProfile: UpdateProfile;
  replaceLinks: ReplaceLinks;
  auth: AuthGateway;
};

/** vCard of the route `/v/{slug}`: rate limit `vcard` on the address of the given request headers, then the file. */
export type DownloadVCardFromRequest = (slug: string, headers: Headers) => Promise<Result<VCardFile | null, RateLimitError>>;

export type PublicContainer = {
  getPublicProfile: GetPublicProfile;
  downloadVCard: DownloadVCardFromRequest;
};

/** Composition root, built once per request: the server client carries the request cookies. */
export async function createContainer(): Promise<Container> {
  const server = await createServerSupabaseClient();
  const admin = createAdminClient();

  const auth = makeSupabaseAuthGateway(server);
  const registrar = makeSupabaseProfileRegistrar(admin);
  const rateLimiter = makeSupabaseRateLimiter(admin, env.RATE_LIMIT_SECRET);
  const profiles = makeSupabaseProfileReader(server);
  const links = makeSupabaseLinkRepository(server);
  const ids = cryptoIdGenerator;

  return {
    auth,
    registerUser: makeRegisterUser({ auth, registrar, ids, rateLimiter }),
    signIn: makeSignIn({ auth, membership: makeSupabaseMembershipReader(server), registrar, ids, rateLimiter }),
    getOwnProfile: makeGetOwnProfile({ auth, profiles, links }),
    updateProfile: makeUpdateProfile({ auth, rateLimiter, profiles, writer: makeSupabaseProfileWriter(server) }),
    replaceLinks: makeReplaceLinks({ auth, rateLimiter, profiles, links }),
  };
}

/** Composition root of the public reads: no cookies, usable in static rendering. */
export function createPublicContainer(): PublicContainer {
  const publicProfiles = makeCachedPublicProfileReader(makeSupabasePublicProfileReader(createPublicSupabaseClient()));
  const getVCard = makeGetVCard({
    publicProfiles,
    profileUrl: (slug) => `${env.SITE_URL}/p/${slug}`,
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
  };
}
