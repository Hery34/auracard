import { afterEach, describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSupabaseAuthGateway } from "@/server/infrastructure/supabase/auth-gateway";
import { makeSupabaseMembershipReader } from "@/server/repositories/supabase-membership-reader";
import { makeSupabaseProfileRegistrar } from "@/server/repositories/supabase-profile-registrar";
import { makeSupabaseRateLimiter } from "@/server/repositories/supabase-rate-limiter";
import { makeRegisterUser } from "@/server/use-cases/register-user";

import { fixedIds } from "../builders/fixed-ids";
import { adminClient, anonClient, type CarnetClient } from "./setup/clients";
import { deleteUsersByEmail, findUserByEmail, findUsersByEmail } from "./setup/cleanup";
import { PASSWORD, RUN_SECRET, uniqueAddress, uniqueDisplayName, uniqueEmail, UUID_PATTERN } from "./setup/fixtures";

describe("registerUser against the local Supabase stack", () => {
  const admin = adminClient();
  const emails: string[] = [];

  function track(email: string): string {
    emails.push(email);
    return email;
  }

  function registerUserOn(session: CarnetClient) {
    return makeRegisterUser({
      auth: makeSupabaseAuthGateway(session),
      registrar: makeSupabaseProfileRegistrar(admin),
      ids: fixedIds(),
      rateLimiter: makeSupabaseRateLimiter(admin, RUN_SECRET),
    });
  }

  /** Session of the account, whatever the confirmation setting of the local stack. */
  async function sessionOf(userId: string, email: string): Promise<CarnetClient> {
    const confirmed = await admin.auth.admin.updateUserById(userId, { email_confirm: true });
    expect(confirmed.error).toBeNull();

    const session = anonClient();
    const signedIn = await session.auth.signInWithPassword({ email, password: PASSWORD });
    expect(signedIn.error).toBeNull();
    return session;
  }

  afterEach(async () => {
    const { survivingProfileIds } = await deleteUsersByEmail(admin, emails.splice(0));

    expect(survivingProfileIds).toStrictEqual([]);
  });

  it("criterion 6: a unique e-mail → GoTrue account, carnet membership and an unpublished profile with the expected slug", async () => {
    const email = track(uniqueEmail());
    const { displayName, slug } = uniqueDisplayName();

    const result = await registerUserOn(anonClient())({
      email,
      password: PASSWORD,
      displayName,
      clientAddress: uniqueAddress(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // Local stack: `enable_confirmations = false` (supabase/config.toml), so GoTrue always creates a session and
    // the use case registers membership and profile at once (option (a): without a session it would write nothing
    // and answer `needsEmailConfirmation: true` without profileId; that path is covered by the unit test only).
    expect(result.value.needsEmailConfirmation).toBe(false);
    const { profileId } = result.value;
    expect(profileId).toBeDefined();
    if (profileId === undefined) {
      throw new Error("profileId attendu avec session");
    }
    expect(profileId).toMatch(UUID_PATTERN);

    const user = await findUserByEmail(admin, email);
    expect(user).toBeDefined();
    if (user === undefined) {
      return;
    }

    const profile = await admin
      .from("profiles")
      .select("owner_id, slug, display_name, is_published")
      .eq("id", profileId)
      .single();
    expect(profile.error).toBeNull();
    expect(profile.data).toStrictEqual({ owner_id: user.id, slug, display_name: displayName, is_published: false });

    const session = await sessionOf(user.id, email);
    expect(await makeSupabaseMembershipReader(session).isMember()).toStrictEqual(ok(true));
  });

  it("criterion 6: registering the same e-mail twice → err('email_taken'); one account and one profile only", async () => {
    const email = track(uniqueEmail());
    const { displayName, slug } = uniqueDisplayName();
    const input = { email, password: PASSWORD, displayName, clientAddress: uniqueAddress() };

    const first = await registerUserOn(anonClient())(input);
    const replay = await registerUserOn(anonClient())(input);

    expect(first.ok).toBe(true);
    expect(replay).toStrictEqual(err("email_taken"));

    expect(await findUsersByEmail(admin, [email])).toHaveLength(1);
    const profiles = await admin.from("profiles").select("slug").eq("slug", slug);
    expect(profiles.error).toBeNull();
    expect(profiles.data).toStrictEqual([{ slug }]);
  });

  it("criterion 6: the 11th registration attempt from one address → err('rate_limited') before any GoTrue call", async () => {
    const address = uniqueAddress();
    const limiter = makeSupabaseRateLimiter(admin, RUN_SECRET);
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect(
        await limiter.consume({ scope: "signup", subject: address, limit: 10, windowSeconds: 3600 }),
      ).toStrictEqual(ok({ allowed: true }));
    }
    const email = track(uniqueEmail());

    const result = await registerUserOn(anonClient())({
      email,
      password: PASSWORD,
      displayName: uniqueDisplayName().displayName,
      clientAddress: address,
    });

    expect(result).toStrictEqual(err("rate_limited"));
    expect(await findUserByEmail(admin, email)).toBeUndefined();
  });
});
