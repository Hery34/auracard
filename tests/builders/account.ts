import type { AuthError } from "@supabase/supabase-js";

import type {
  CarnetAccountEraser,
  InstanceAccountRemover,
  MediaFolderCleaner,
  PublicProfileCache,
} from "@/domain/account/ports";
import { ok, type Result } from "@/domain/shared/result";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

import { makeCallLog, scriptedResults, type CallLog } from "./call-log";
import type { FakePostgrestError } from "./fake-supabase-admin";
import { authApiError } from "./fake-supabase-auth";

export type VoidResult = Result<void, "unexpected">;
export type OrphanResult = Result<boolean, "unexpected">;
/** Slug of the profile deleted by `delete_own_account()`, `null` when there was none (replay, no profile). */
export type EraseResult = Result<string | null, "unexpected">;

/** Exact word of the confirmation field (0023, decision 1). */
export const DELETION_CONFIRMATION = "SUPPRIMER";

export type FakeMediaFolderCleanerOptions = { log?: CallLog; results?: readonly VoidResult[] };

export function fakeMediaFolderCleaner(options: FakeMediaFolderCleanerOptions = {}): MediaFolderCleaner {
  const log = options.log ?? makeCallLog();
  const next = scriptedResults<VoidResult>(options.results, ok(undefined));
  return {
    async empty(profileId) {
      log.record("mediaFolder", "empty", profileId);
      return next();
    },
  };
}

export type FakeCarnetAccountEraserOptions = {
  log?: CallLog;
  /** Answers in call order; the last one repeats. Defaults to `ok(null)` (nothing deleted held a profile). */
  results?: readonly EraseResult[];
};

export function fakeCarnetAccountEraser(options: FakeCarnetAccountEraserOptions = {}): CarnetAccountEraser {
  const log = options.log ?? makeCallLog();
  const next = scriptedResults<EraseResult>(options.results, ok(null));
  return {
    async erase() {
      log.record("carnetAccount", "erase", undefined);
      return next();
    },
  };
}

export type FakeInstanceAccountRemoverOptions = {
  log?: CallLog;
  /** Answers of `isOrphan` in call order; the last one repeats. Defaults to `ok(true)` (carnet was the only project). */
  isOrphanResults?: readonly OrphanResult[];
  removeResults?: readonly VoidResult[];
};

export function fakeInstanceAccountRemover(options: FakeInstanceAccountRemoverOptions = {}): InstanceAccountRemover {
  const log = options.log ?? makeCallLog();
  const nextOrphan = scriptedResults<OrphanResult>(options.isOrphanResults, ok(true));
  const nextRemove = scriptedResults<VoidResult>(options.removeResults, ok(undefined));
  return {
    async isOrphan(userId) {
      log.record("instanceAccounts", "isOrphan", userId);
      return nextOrphan();
    },
    async remove(userId) {
      log.record("instanceAccounts", "remove", userId);
      return nextRemove();
    },
  };
}

export function fakePublicProfileCache(options: { log?: CallLog } = {}): PublicProfileCache {
  const log = options.log ?? makeCallLog();
  return {
    expire(slug) {
      log.record("profileCache", "expire", slug);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Supabase stand-ins for the adapters of 0023
// ---------------------------------------------------------------------------------------------------------------------

export type StorageError = { name: string; message: string; status?: number; statusCode?: string };

export type StorageCall =
  | { readonly method: "list"; readonly bucket: string; readonly path: string; readonly options: unknown }
  | { readonly method: "remove"; readonly bucket: string; readonly names: readonly string[] };

export type FakeStorageBucketOptions = {
  /** Full object names (`<folder>/<file>`) present in each bucket before the test. */
  objects?: Readonly<Record<string, readonly string[]>>;
  /** Default page size when `list` gets no `limit` (Storage answers 100). */
  defaultLimit?: number;
  /** Fails the n-th call (1-based) of `list` / `remove` with this error. */
  failList?: { call: number; error: StorageError };
  failRemove?: { call: number; error: StorageError };
  /** `remove` answers success but deletes nothing (what Storage does when the policies filter every object out). */
  removeIgnored?: boolean;
};

export type FakeStorageBucket = {
  client: CarnetClient;
  calls: StorageCall[];
  /** Objects currently stored in a bucket, sorted. */
  objectsOf(bucket: string): string[];
};

/**
 * Semantic stand-in of `client.storage.from(bucket)`: `list(path, { limit, offset })` pages through the direct children
 * of the folder `path` (file names only, sorted, like Storage), `remove(names)` deletes the named objects (unknown
 * names ignored, like Storage). Paging while removing behaves as the real API does.
 */
export function fakeStorageBucket(options: FakeStorageBucketOptions = {}): FakeStorageBucket {
  const store = new Map<string, Set<string>>();
  for (const [bucket, names] of Object.entries(options.objects ?? {})) {
    store.set(bucket, new Set(names));
  }
  const calls: StorageCall[] = [];
  let listCalls = 0;
  let removeCalls = 0;
  const defaultLimit = options.defaultLimit ?? 100;

  const objectsOf = (bucket: string) => [...(store.get(bucket) ?? [])].sort();

  const client = {
    storage: {
      from(bucket: string) {
        return {
          async list(path?: string, listOptions?: { limit?: number; offset?: number }) {
            calls.push({ method: "list", bucket, path: path ?? "", options: listOptions });
            listCalls += 1;
            if (options.failList?.call === listCalls) {
              return { data: null, error: options.failList.error };
            }
            const prefix = path === undefined || path === "" ? "" : `${path.replace(/\/$/, "")}/`;
            const children = objectsOf(bucket)
              .filter((name) => name.startsWith(prefix) && !name.slice(prefix.length).includes("/"))
              .map((name) => name.slice(prefix.length));
            const offset = listOptions?.offset ?? 0;
            const limit = listOptions?.limit ?? defaultLimit;
            const page = children.slice(offset, offset + limit).map((name) => ({
              name,
              id: `id-${name}`,
              updated_at: "2026-11-17T10:00:00.000Z",
              created_at: "2026-11-17T10:00:00.000Z",
              last_accessed_at: "2026-11-17T10:00:00.000Z",
              metadata: { size: 1024, mimetype: "image/jpeg" },
            }));
            return { data: page, error: null };
          },
          async remove(names: string[]) {
            calls.push({ method: "remove", bucket, names: [...names] });
            removeCalls += 1;
            if (options.failRemove?.call === removeCalls) {
              return { data: null, error: options.failRemove.error };
            }
            if (options.removeIgnored === true) {
              return { data: [], error: null };
            }
            const objects = store.get(bucket) ?? new Set<string>();
            const removed = names.filter((name) => objects.delete(name));
            store.set(bucket, objects);
            return { data: removed.map((name) => ({ name })), error: null };
          },
        };
      },
    },
  };

  return { client: client as unknown as CarnetClient, calls, objectsOf };
}

export type AdminAccountsCall =
  | { readonly kind: "rpc"; readonly fn: string; readonly args: unknown }
  | { readonly kind: "deleteUser"; readonly args: readonly unknown[] };

export type FakeSupabaseAdminAccountsOptions = {
  isOrphan?: { data: unknown; error: FakePostgrestError | null };
  deleteUser?: { error: AuthError | null };
};

/** `service_role` stand-in: `rpc("is_orphan_account", args)` and `auth.admin.deleteUser(...args)`, both recorded. */
export function fakeSupabaseAdminAccounts(options: FakeSupabaseAdminAccountsOptions = {}): {
  client: CarnetClient;
  calls: AdminAccountsCall[];
} {
  const calls: AdminAccountsCall[] = [];
  const isOrphan = options.isOrphan ?? { data: true, error: null };
  const deleteUser = options.deleteUser ?? { error: null };
  const client = {
    async rpc(fn: string, args: unknown) {
      calls.push({ kind: "rpc", fn, args });
      if (fn !== "is_orphan_account") {
        throw new Error(`fakeSupabaseAdminAccounts: unexpected rpc ${fn}`);
      }
      return { ...isOrphan, count: null, status: isOrphan.error ? 400 : 200, statusText: "" };
    },
    auth: {
      admin: {
        async deleteUser(...args: unknown[]) {
          calls.push({ kind: "deleteUser", args });
          return { data: deleteUser.error ? { user: null } : { user: { id: args[0] } }, error: deleteUser.error };
        },
      },
    },
  };
  return { client: client as unknown as CarnetClient, calls };
}

/** What `auth.admin.deleteUser` answers for an id GoTrue does not know (already deleted). */
export function userNotFound(): AuthError {
  return authApiError("user_not_found", 404, "User not found");
}
