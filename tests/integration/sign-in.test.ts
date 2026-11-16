import { afterEach, describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSupabaseAuthGateway } from "@/server/infrastructure/supabase/auth-gateway";
import { makeSupabaseMembershipReader } from "@/server/repositories/supabase-membership-reader";
import { makeSupabaseProfileRegistrar } from "@/server/repositories/supabase-profile-registrar";
import { makeSupabaseRateLimiter } from "@/server/repositories/supabase-rate-limiter";
import { makeSignIn } from "@/server/use-cases/sign-in";

import { fixedIds } from "../builders/fixed-ids";
import { adminClient, anonClient, type CarnetClient } from "./setup/clients";
import { deleteUsersByEmail } from "./setup/cleanup";
import { PASSWORD, RUN_SECRET, uniqueAddress, uniqueDisplayName, uniqueEmail } from "./setup/fixtures";

describe("signIn (with ensure-membership) against the local Supabase stack", () => {
  const admin = adminClient();
  const emails: string[] = [];

  function track(email: string): string {
    emails.push(email);
    return email;
  }

  /** The gateway and the membership reader share the client, as the per-request server client does in production. */
  function signInOn(session: CarnetClient) {
    return makeSignIn({
      auth: makeSupabaseAuthGateway(session),
      membership: makeSupabaseMembershipReader(session),
      registrar: makeSupabaseProfileRegistrar(admin),
      ids: fixedIds(),
      rateLimiter: makeSupabaseRateLimiter(admin, RUN_SECRET),
    });
  }

  /** Account created directly by the admin client: exists on the instance, no carnet membership (ADR 0002 scenario). */
  async function createAccountWithoutMembership(email: string): Promise<string> {
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error !== null || data.user === null) {
      throw error ?? new Error("createUser returned no user");
    }
    return data.user.id;
  }

  async function profilesOf(userId: string) {
    const { data, error } = await admin
      .from("profiles")
      .select("owner_id, slug, display_name, is_published")
      .eq("owner_id", userId);
    expect(error).toBeNull();
    return data ?? [];
  }

  afterEach(async () => {
    const { survivingProfileIds } = await deleteUsersByEmail(admin, emails.splice(0));

    expect(survivingProfileIds).toStrictEqual([]);
  });

  it("criterion 6: an account without membership signing in with a display name joins carnet (membership + profile, joined: true); the second sign-in → joined: false", async () => {
    const email = track(uniqueEmail());
    const userId = await createAccountWithoutMembership(email);
    const { displayName, slug } = uniqueDisplayName();
    const address = uniqueAddress();
    const session = anonClient();

    const first = await signInOn(session)({ email, password: PASSWORD, displayName, clientAddress: address });

    expect(first).toStrictEqual(ok({ userId, joined: true }));
    expect(await profilesOf(userId)).toStrictEqual([{ owner_id: userId, slug, display_name: displayName, is_published: false }]);
    expect(await makeSupabaseMembershipReader(session).isMember()).toStrictEqual(ok(true));

    const second = await signInOn(anonClient())({ email, password: PASSWORD, displayName, clientAddress: address });

    expect(second).toStrictEqual(ok({ userId, joined: false }));
    expect(await profilesOf(userId)).toHaveLength(1);
  });

  it("criterion 6: an account without membership and without a display name → err('display_name_required'), nothing written", async () => {
    const email = track(uniqueEmail());
    const userId = await createAccountWithoutMembership(email);

    const result = await signInOn(anonClient())({ email, password: PASSWORD, clientAddress: uniqueAddress() });

    expect(result).toStrictEqual(err("display_name_required"));
    expect(await profilesOf(userId)).toStrictEqual([]);
  });

  it("a wrong password → err('invalid_credentials'), nothing written", async () => {
    const email = track(uniqueEmail());
    const userId = await createAccountWithoutMembership(email);

    const result = await signInOn(anonClient())({
      email,
      password: "not the password",
      displayName: uniqueDisplayName().displayName,
      clientAddress: uniqueAddress(),
    });

    expect(result).toStrictEqual(err("invalid_credentials"));
    expect(await profilesOf(userId)).toStrictEqual([]);
  });

  it("an unknown e-mail → err('invalid_credentials') (no account enumeration)", async () => {
    const result = await signInOn(anonClient())({
      email: uniqueEmail(),
      password: PASSWORD,
      clientAddress: uniqueAddress(),
    });

    expect(result).toStrictEqual(err("invalid_credentials"));
  });
});
