import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import { env } from "@/server/infrastructure/env";
import { cryptoIdGenerator } from "@/server/infrastructure/id-generator";
import { createAdminClient } from "@/server/infrastructure/supabase/admin";
import { makeSupabaseAuthGateway } from "@/server/infrastructure/supabase/auth-gateway";
import { createServerSupabaseClient } from "@/server/infrastructure/supabase/server";
import { makeSupabaseMembershipReader } from "@/server/repositories/supabase-membership-reader";
import { makeSupabaseProfileReader } from "@/server/repositories/supabase-profile-reader";
import { makeSupabaseProfileRegistrar } from "@/server/repositories/supabase-profile-registrar";
import { makeSupabaseRateLimiter } from "@/server/repositories/supabase-rate-limiter";
import { makeGetOwnProfile, type GetOwnProfile } from "@/server/use-cases/get-own-profile";
import { makeRegisterUser, type RegisterUser } from "@/server/use-cases/register-user";
import { makeSignIn, type SignIn } from "@/server/use-cases/sign-in";

export type Container = {
  registerUser: RegisterUser;
  signIn: SignIn;
  getOwnProfile: GetOwnProfile;
  auth: AuthGateway;
};

/** Composition root, built once per request: the server client carries the request cookies. */
export async function createContainer(): Promise<Container> {
  const server = await createServerSupabaseClient();
  const admin = createAdminClient();

  const auth = makeSupabaseAuthGateway(server);
  const registrar = makeSupabaseProfileRegistrar(admin);
  const rateLimiter = makeSupabaseRateLimiter(admin, env.RATE_LIMIT_SECRET);
  const ids = cryptoIdGenerator;

  return {
    auth,
    registerUser: makeRegisterUser({ auth, registrar, ids, rateLimiter }),
    signIn: makeSignIn({ auth, membership: makeSupabaseMembershipReader(server), registrar, ids, rateLimiter }),
    getOwnProfile: makeGetOwnProfile({ auth, profiles: makeSupabaseProfileReader(server) }),
  };
}
