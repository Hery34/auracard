import { makeSupabaseProfileRegistrar } from "@/server/repositories/supabase-profile-registrar";

import { aSlug } from "../../builders/slug";
import { anonClient, type CarnetClient } from "./clients";
import { PASSWORD, uniqueDisplayName, uniqueEmail } from "./fixtures";

export type Member = { userId: string; email: string; profileId: string; slug: string; displayName: string; session: CarnetClient };

export type Outsider = { userId: string; email: string; session: CarnetClient };

async function createConfirmedAccount(admin: CarnetClient, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error !== null || data.user === null) {
    throw error ?? new Error("createUser returned no user");
  }
  return data.user.id;
}

async function signedIn(email: string): Promise<CarnetClient> {
  const session = anonClient();
  const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
  if (error !== null) {
    throw error;
  }
  return session;
}

/**
 * A carnet member with its unpublished initial profile (`register_member`, as registration does) and a signed-in
 * session standing for the per-request server client. `track` receives the e-mail for the cleanup of `afterEach`.
 */
export async function createMember(admin: CarnetClient, track: (email: string) => string): Promise<Member> {
  const email = track(uniqueEmail());
  const userId = await createConfirmedAccount(admin, email);
  const { displayName, slug } = uniqueDisplayName();
  const registered = await makeSupabaseProfileRegistrar(admin).register({ userId, displayName, slug: aSlug(slug) });
  if (!registered.ok) {
    throw new Error(`register_member failed: ${registered.error}`);
  }
  return { userId, email, profileId: registered.value.profileId, slug, displayName, session: await signedIn(email) };
}

/** An account of the shared instance that is not a member of carnet (account of another project, ADR 0002). */
export async function createOutsider(admin: CarnetClient, track: (email: string) => string): Promise<Outsider> {
  const email = track(uniqueEmail());
  const userId = await createConfirmedAccount(admin, email);
  return { userId, email, session: await signedIn(email) };
}
