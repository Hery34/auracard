import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  type AuthError,
} from "@supabase/supabase-js";

import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

import { GATEWAY_USER_EMAIL, GATEWAY_USER_ID } from "./fake-auth-gateway";

export type GoTrueUser = {
  id: string;
  email: string;
  identities: Array<{ id: string; provider: string }>;
};

export type GoTrueSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: "bearer";
  user: GoTrueUser;
};

type AuthResponse<D> = { data: D; error: AuthError | null };
type UserAndSession = { user: GoTrueUser | null; session: GoTrueSession | null };

export type AuthCall = { readonly method: string; readonly args: unknown };

export type FakeSupabaseAuthOptions = {
  signUp?: AuthResponse<UserAndSession>;
  signInWithPassword?: AuthResponse<UserAndSession>;
  signOut?: { error: AuthError | null };
  getUser?: AuthResponse<{ user: GoTrueUser | null }>;
};

export type FakeSupabaseAuth = { client: CarnetClient; calls: AuthCall[] };

export function aGoTrueUser(overrides: Partial<GoTrueUser> = {}): GoTrueUser {
  return {
    id: GATEWAY_USER_ID,
    email: GATEWAY_USER_EMAIL,
    identities: [{ id: GATEWAY_USER_ID, provider: "email" }],
    ...overrides,
  };
}

export function aSession(user: GoTrueUser = aGoTrueUser()): GoTrueSession {
  return { access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600, token_type: "bearer", user };
}

/** Error answered by the GoTrue REST API (`code` and `status`, as supabase-js builds it). */
export function authApiError(code: string, status = 400, message = `GoTrue ${code}: raw server message`): AuthApiError {
  return new AuthApiError(message, status, code);
}

/** Network failure before any GoTrue answer. */
export function retryableFetchError(): AuthRetryableFetchError {
  return new AuthRetryableFetchError("fetch failed", 0);
}

export function sessionMissingError(): AuthSessionMissingError {
  return new AuthSessionMissingError();
}

/** The `{ data, error }` of a refused sign-up or sign-in: supabase-js nulls both `user` and `session`. */
export function refused(error: AuthError): AuthResponse<UserAndSession> {
  return { data: { user: null, session: null }, error };
}

/**
 * Minimal stand-in for the server client: only `auth.signUp`, `auth.signInWithPassword`, `auth.signOut` and
 * `auth.getUser` exist; each resolves to its scripted answer and records its arguments.
 */
export function fakeSupabaseAuth(options: FakeSupabaseAuthOptions = {}): FakeSupabaseAuth {
  const calls: AuthCall[] = [];
  const user = aGoTrueUser();
  const answers = {
    signUp: options.signUp ?? { data: { user, session: aSession(user) }, error: null },
    signInWithPassword: options.signInWithPassword ?? { data: { user, session: aSession(user) }, error: null },
    signOut: options.signOut ?? { error: null },
    getUser: options.getUser ?? { data: { user }, error: null },
  };
  const scripted = <K extends keyof typeof answers>(method: K) => {
    return async (args?: unknown) => {
      calls.push({ method, args });
      return answers[method];
    };
  };
  const client = {
    auth: {
      signUp: scripted("signUp"),
      signInWithPassword: scripted("signInWithPassword"),
      signOut: scripted("signOut"),
      getUser: scripted("getUser"),
    },
  };

  return { client: client as unknown as CarnetClient, calls };
}
