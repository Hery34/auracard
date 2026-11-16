import type { AuthGateway, SignInError, SignUpError } from "@/domain/shared/ports/auth-gateway";
import { ok, type Result } from "@/domain/shared/result";

import { makeCallLog, type CallLog } from "./call-log";

/** Identifier handed back by the fake gateway: use cases must forward it, never an input of the client. */
export const GATEWAY_USER_ID = "7d0c1a2e-3b4f-4c5d-8e6f-0a1b2c3d4e5f";
export const GATEWAY_USER_EMAIL = "elodie@example.test";

export type FakeAuthGatewayOptions = {
  log?: CallLog;
  signUp?: Result<{ userId: string; sessionCreated: boolean }, SignUpError>;
  signIn?: Result<{ userId: string }, SignInError>;
  signOut?: Result<void, "unexpected">;
  currentUser?: Result<{ userId: string; email: string } | null, "unexpected">;
};

export function fakeAuthGateway(options: FakeAuthGatewayOptions = {}): AuthGateway {
  const log = options.log ?? makeCallLog();
  const signUp = options.signUp ?? ok({ userId: GATEWAY_USER_ID, sessionCreated: true });
  const signIn = options.signIn ?? ok({ userId: GATEWAY_USER_ID });
  const signOut = options.signOut ?? ok(undefined);
  const currentUser = options.currentUser ?? ok(null);

  return {
    async signUp(input) {
      log.record("auth", "signUp", input);
      return signUp;
    },
    async signIn(input) {
      log.record("auth", "signIn", input);
      return signIn;
    },
    async signOut() {
      log.record("auth", "signOut", undefined);
      return signOut;
    },
    async currentUser() {
      log.record("auth", "currentUser", undefined);
      return currentUser;
    },
  };
}
