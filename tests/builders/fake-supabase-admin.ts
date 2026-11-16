import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/infrastructure/supabase/database.types";

export type RpcCall = { readonly fn: string; readonly args: unknown };

/** Shape of a PostgREST error as returned by `await client.rpc(...)` (`error` field). */
export type FakePostgrestError = {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
};

export type FakeRpcResponse = { data: unknown; error: FakePostgrestError | null };

export type FakeSupabaseAdmin = {
  client: SupabaseClient<Database, "carnet">;
  calls: RpcCall[];
};

/**
 * Minimal stand-in for the `service_role` client: only `rpc(fn, args)` exists and it resolves to the
 * scripted `{ data, error }` (the resolved value of `await client.rpc(...)`).
 */
export function fakeSupabaseAdmin(response: FakeRpcResponse): FakeSupabaseAdmin {
  const calls: RpcCall[] = [];
  const client = {
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return { ...response, count: null, status: response.error ? 400 : 200, statusText: "" };
    },
  };

  return { client: client as unknown as SupabaseClient<Database, "carnet">, calls };
}

export const DUPLICATE_SLUG_ERROR: FakePostgrestError = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "profiles_slug_key"',
  details: "Key (slug)=(elodie-durand-merel) already exists.",
  hint: null,
};

export const DUPLICATE_OWNER_ERROR: FakePostgrestError = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "profiles_owner_id_key"',
  details: "Key (owner_id)=(7d0c1a2e-3b4f-4c5d-8e6f-0a1b2c3d4e5f) already exists.",
  hint: null,
};

export const PROJECT_INACTIVE_ERROR: FakePostgrestError = {
  code: "P0001",
  message: "carnet: projet inactif ou absent du registre",
  details: null,
  hint: null,
};

export const UNKNOWN_USER_ERROR: FakePostgrestError = {
  code: "23503",
  message: 'insert or update on table "project_members" violates foreign key constraint "project_members_user_id_fkey"',
  details: "Key (user_id)=(7d0c1a2e-3b4f-4c5d-8e6f-0a1b2c3d4e5f) is not present in table \"users\".",
  hint: null,
};

export const CHECK_VIOLATION_ERROR: FakePostgrestError = {
  code: "23514",
  message: 'new row for relation "profiles" violates check constraint "profiles_slug_format_check"',
  details: "Failing row contains (…, elodie, Élodie, …).",
  hint: null,
};
