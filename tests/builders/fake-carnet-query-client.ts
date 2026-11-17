import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

import type { FakePostgrestError } from "./fake-supabase-admin";

export type FakeQueryResponse = { data: unknown; error: FakePostgrestError | null };

export type QueryCall =
  | { readonly kind: "rpc"; readonly fn: string; readonly args: unknown }
  | { readonly kind: "select"; readonly table: string; readonly columns: string };

/** `await builder` and `await builder.maybeSingle()` / `.single()` both resolve to the scripted response. */
function thenable(response: FakeQueryResponse) {
  const resolved = { ...response, count: null, status: response.error ? 400 : 200, statusText: "" };
  const builder = {
    maybeSingle: async () => resolved,
    single: async () => resolved,
    then: <T>(onFulfilled: (value: typeof resolved) => T, onRejected?: (reason: unknown) => T) =>
      Promise.resolve(resolved).then(onFulfilled, onRejected),
  };
  return builder;
}

/**
 * Read-only stand-in of a `carnet` client: `rpc(fn, args)` answers `rpc[fn]`, `from(table).select(columns)` answers
 * `tables[table]`, each one awaitable directly or through `.maybeSingle()` / `.single()`. Unknown names throw.
 */
export function fakeCarnetQueryClient(responses: {
  rpc?: Record<string, FakeQueryResponse>;
  tables?: Record<string, FakeQueryResponse>;
}): { client: CarnetClient; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const client = {
    rpc(fn: string, args: unknown) {
      calls.push({ kind: "rpc", fn, args });
      const response = responses.rpc?.[fn];
      if (response === undefined) {
        throw new Error(`fakeCarnetQueryClient: unexpected rpc ${fn}`);
      }
      return thenable(response);
    },
    from(table: string) {
      return {
        select(columns: string) {
          calls.push({ kind: "select", table, columns });
          const response = responses.tables?.[table];
          if (response === undefined) {
            throw new Error(`fakeCarnetQueryClient: unexpected table ${table}`);
          }
          return thenable(response);
        },
      };
    },
  };
  return { client: client as unknown as CarnetClient, calls };
}
