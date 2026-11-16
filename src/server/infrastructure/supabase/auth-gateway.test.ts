import { afterEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSupabaseAuthGateway } from "@/server/infrastructure/supabase/auth-gateway";

import { GATEWAY_USER_EMAIL, GATEWAY_USER_ID } from "../../../../tests/builders/fake-auth-gateway";
import {
  aGoTrueUser,
  aSession,
  authApiError,
  fakeSupabaseAuth,
  refused,
  retryableFetchError,
  sessionMissingError,
} from "../../../../tests/builders/fake-supabase-auth";

const credentials = { email: "elodie@example.test", password: "correct horse battery staple" };

function spyConsole() {
  return (["error", "warn", "log", "info"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
}

function loggedLines(spies: ReturnType<typeof spyConsole>): string[] {
  return spies.flatMap((spy) => spy.mock.calls.map((call) => JSON.stringify(call)));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("makeSupabaseAuthGateway", () => {
  describe("signUp", () => {
    it("calls auth.signUp with the e-mail and the password", async () => {
      const fake = fakeSupabaseAuth();

      await makeSupabaseAuthGateway(fake.client).signUp(credentials);

      expect(fake.calls).toStrictEqual([{ method: "signUp", args: credentials }]);
    });

    it("user with a session → ok({ userId, sessionCreated: true })", async () => {
      const fake = fakeSupabaseAuth();

      expect(await makeSupabaseAuthGateway(fake.client).signUp(credentials)).toStrictEqual(
        ok({ userId: GATEWAY_USER_ID, sessionCreated: true }),
      );
    });

    it("user without a session (confirmation pending) → ok({ userId, sessionCreated: false })", async () => {
      const fake = fakeSupabaseAuth({ signUp: { data: { user: aGoTrueUser(), session: null }, error: null } });

      expect(await makeSupabaseAuthGateway(fake.client).signUp(credentials)).toStrictEqual(
        ok({ userId: GATEWAY_USER_ID, sessionCreated: false }),
      );
    });

    it("obfuscated user without identities (confirmations enabled, e-mail already taken) → err('email_taken')", async () => {
      const fake = fakeSupabaseAuth({
        signUp: { data: { user: aGoTrueUser({ identities: [] }), session: null }, error: null },
      });

      expect(await makeSupabaseAuthGateway(fake.client).signUp(credentials)).toStrictEqual(err("email_taken"));
    });

    it.each([
      ["user_already_exists", 422],
      ["email_exists", 422],
    ])("GoTrue code %s (%d) → err('email_taken')", async (code, status) => {
      const fake = fakeSupabaseAuth({ signUp: refused(authApiError(code, status)) });

      expect(await makeSupabaseAuthGateway(fake.client).signUp(credentials)).toStrictEqual(err("email_taken"));
    });

    it("GoTrue code weak_password → err('weak_password')", async () => {
      const fake = fakeSupabaseAuth({ signUp: refused(authApiError("weak_password", 422)) });

      expect(await makeSupabaseAuthGateway(fake.client).signUp(credentials)).toStrictEqual(err("weak_password"));
    });

    it.each([
      ["over_request_rate_limit", 429],
      ["over_email_send_rate_limit", 429],
    ])("GoTrue code %s (%d) → err('rate_limited')", async (code, status) => {
      const fake = fakeSupabaseAuth({ signUp: refused(authApiError(code, status)) });

      expect(await makeSupabaseAuthGateway(fake.client).signUp(credentials)).toStrictEqual(err("rate_limited"));
    });

    it("GoTrue code signup_disabled → err('registration_closed')", async () => {
      const fake = fakeSupabaseAuth({ signUp: refused(authApiError("signup_disabled", 422)) });

      expect(await makeSupabaseAuthGateway(fake.client).signUp(credentials)).toStrictEqual(
        err("registration_closed"),
      );
    });

    it("any other GoTrue error → err('unexpected') without writing its message to the console", async () => {
      const spies = spyConsole();
      const error = authApiError("unexpected_failure", 500, "raw GoTrue message with elodie@example.test");
      const fake = fakeSupabaseAuth({ signUp: refused(error) });

      expect(await makeSupabaseAuthGateway(fake.client).signUp(credentials)).toStrictEqual(err("unexpected"));
      for (const line of loggedLines(spies)) {
        expect(line).not.toContain(error.message);
      }
    });

    it("no user and no error (malformed answer) → err('unexpected')", async () => {
      const fake = fakeSupabaseAuth({ signUp: { data: { user: null, session: null }, error: null } });

      expect(await makeSupabaseAuthGateway(fake.client).signUp(credentials)).toStrictEqual(err("unexpected"));
    });
  });

  describe("signIn", () => {
    it("calls auth.signInWithPassword and answers ok({ userId })", async () => {
      const fake = fakeSupabaseAuth();

      expect(await makeSupabaseAuthGateway(fake.client).signIn(credentials)).toStrictEqual(
        ok({ userId: GATEWAY_USER_ID }),
      );
      expect(fake.calls).toStrictEqual([{ method: "signInWithPassword", args: credentials }]);
    });

    it("GoTrue code invalid_credentials → err('invalid_credentials')", async () => {
      const fake = fakeSupabaseAuth({ signInWithPassword: refused(authApiError("invalid_credentials", 400)) });

      expect(await makeSupabaseAuthGateway(fake.client).signIn(credentials)).toStrictEqual(
        err("invalid_credentials"),
      );
    });

    it("GoTrue code email_not_confirmed → err('email_not_confirmed')", async () => {
      const fake = fakeSupabaseAuth({ signInWithPassword: refused(authApiError("email_not_confirmed", 400)) });

      expect(await makeSupabaseAuthGateway(fake.client).signIn(credentials)).toStrictEqual(
        err("email_not_confirmed"),
      );
    });

    it("GoTrue code over_request_rate_limit → err('rate_limited')", async () => {
      const fake = fakeSupabaseAuth({ signInWithPassword: refused(authApiError("over_request_rate_limit", 429)) });

      expect(await makeSupabaseAuthGateway(fake.client).signIn(credentials)).toStrictEqual(err("rate_limited"));
    });

    it("any other GoTrue error → err('unexpected') without writing its message to the console", async () => {
      const spies = spyConsole();
      const error = authApiError("unexpected_failure", 500, "raw GoTrue message with elodie@example.test");
      const fake = fakeSupabaseAuth({ signInWithPassword: refused(error) });

      expect(await makeSupabaseAuthGateway(fake.client).signIn(credentials)).toStrictEqual(err("unexpected"));
      for (const line of loggedLines(spies)) {
        expect(line).not.toContain(error.message);
      }
    });
  });

  describe("signOut", () => {
    it("no error → ok(undefined)", async () => {
      const fake = fakeSupabaseAuth();

      expect(await makeSupabaseAuthGateway(fake.client).signOut()).toStrictEqual(ok(undefined));
      expect(fake.calls.map((call) => call.method)).toStrictEqual(["signOut"]);
    });

    it("calls auth.signOut({ scope: 'local' }): never the global scope, which would sign the account out of the other projects of the shared instance (ADR 0002)", async () => {
      const fake = fakeSupabaseAuth();

      await makeSupabaseAuthGateway(fake.client).signOut();

      expect(fake.calls).toStrictEqual([{ method: "signOut", args: { scope: "local" } }]);
    });

    it("error → err('unexpected')", async () => {
      const fake = fakeSupabaseAuth({ signOut: { error: retryableFetchError() } });

      expect(await makeSupabaseAuthGateway(fake.client).signOut()).toStrictEqual(err("unexpected"));
    });
  });

  describe("currentUser", () => {
    it("authenticated user → ok({ userId, email })", async () => {
      const fake = fakeSupabaseAuth();

      expect(await makeSupabaseAuthGateway(fake.client).currentUser()).toStrictEqual(
        ok({ userId: GATEWAY_USER_ID, email: GATEWAY_USER_EMAIL }),
      );
      expect(fake.calls.map((call) => call.method)).toStrictEqual(["getUser"]);
    });

    it("missing session → ok(null)", async () => {
      const fake = fakeSupabaseAuth({ getUser: { data: { user: null }, error: sessionMissingError() } });

      expect(await makeSupabaseAuthGateway(fake.client).currentUser()).toStrictEqual(ok(null));
    });

    it("rejected token (401) → ok(null)", async () => {
      const fake = fakeSupabaseAuth({ getUser: { data: { user: null }, error: authApiError("bad_jwt", 401) } });

      expect(await makeSupabaseAuthGateway(fake.client).currentUser()).toStrictEqual(ok(null));
    });

    it("network failure (retryable fetch error) → err('unexpected')", async () => {
      const fake = fakeSupabaseAuth({ getUser: { data: { user: null }, error: retryableFetchError() } });

      expect(await makeSupabaseAuthGateway(fake.client).currentUser()).toStrictEqual(err("unexpected"));
    });
  });

  it("the same session user signs up with a fresh session object each time (no shared state between calls)", async () => {
    const fake = fakeSupabaseAuth({ signUp: { data: { user: aGoTrueUser(), session: aSession() }, error: null } });
    const gateway = makeSupabaseAuthGateway(fake.client);

    expect(await gateway.signUp(credentials)).toStrictEqual(await gateway.signUp(credentials));
    expect(fake.calls).toHaveLength(2);
  });
});
