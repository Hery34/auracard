import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

import type { FakePostgrestError } from "./fake-supabase-admin";

export type FakeQueryResponse = { data: unknown; error: FakePostgrestError | null };

export type QueryCall =
  | { readonly kind: "rpc"; readonly fn: string; readonly args: unknown }
  | { readonly kind: "select"; readonly table: string; readonly columns: string; readonly modifiers: QueryModifier[] };

/**
 * `await builder` and `await builder.maybeSingle()` / `.single()` both resolve to the scripted response; an array
 * scripted for a set-returning function becomes its first row (or `null`) through `.maybeSingle()` / `.single()`.
 * Filters and ordering (`eq`, `order`) are chainable and recorded in `modifiers`, without effect on the response.
 */
function thenable(response: FakeQueryResponse, modifiers: QueryModifier[]) {
  const resolved = { ...response, count: null, status: response.error ? 400 : 200, statusText: "" };
  const single = async () =>
    Array.isArray(resolved.data) ? { ...resolved, data: (resolved.data[0] as unknown) ?? null } : resolved;
  const builder = {
    maybeSingle: single,
    single,
    eq(column: string, value: unknown) {
      modifiers.push({ kind: "eq", column, value });
      return builder;
    },
    order(column: string, options?: unknown) {
      modifiers.push({ kind: "order", column, options });
      return builder;
    },
    then: <T>(onFulfilled: (value: typeof resolved) => T, onRejected?: (reason: unknown) => T) =>
      Promise.resolve(resolved).then(onFulfilled, onRejected),
  };
  return builder;
}

export type QueryModifier =
  | { readonly kind: "eq"; readonly column: string; readonly value: unknown }
  | { readonly kind: "order"; readonly column: string; readonly options: unknown };

/**
 * Read-only stand-in of a `carnet` client: `rpc(fn, args)` answers `rpc[fn]`, `from(table).select(columns)` answers
 * `tables[table]`, each one awaitable directly or through `.maybeSingle()` / `.single()`. Unknown names throw.
 */
export function fakeCarnetQueryClient(responses: {
  rpc?: Record<string, FakeQueryResponse>;
  tables?: Record<string, FakeQueryResponse>;
}): { client: CarnetClient; calls: QueryCall[] } {
  const none: QueryModifier[] = [];
  const calls: QueryCall[] = [];
  const client = {
    rpc(fn: string, args: unknown) {
      calls.push({ kind: "rpc", fn, args });
      const response = responses.rpc?.[fn];
      if (response === undefined) {
        throw new Error(`fakeCarnetQueryClient: unexpected rpc ${fn}`);
      }
      return thenable(response, none);
    },
    from(table: string) {
      return {
        select(columns: string) {
          const modifiers: QueryModifier[] = [];
          calls.push({ kind: "select", table, columns, modifiers });
          const response = responses.tables?.[table];
          if (response === undefined) {
            throw new Error(`fakeCarnetQueryClient: unexpected table ${table}`);
          }
          return thenable(response, modifiers);
        },
      };
    },
  };
  return { client: client as unknown as CarnetClient, calls };
}
