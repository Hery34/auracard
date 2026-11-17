/**
 * Wiring of `deleteAccount` in `createContainer` (0023; ADR 0011 amendment of 17/11/2026). Only the Supabase clients,
 * the adapters and Next.js are replaced; the use case is real.
 *
 * Contract frozen by test-engineer:
 * // src/server/container.ts — Container gains `deleteAccount: DeleteAccount`, built by makeDeleteAccount with:
 * //   mediaFolder: makeSupabaseMediaFolderCleaner(server)        — session client (Storage policies of 0021)
 * //   carnetAccount: makeSupabaseCarnetAccountEraser(server)     — session client (delete_own_account, auth.uid())
 * //   instanceAccounts: makeSupabaseInstanceAccountRemover(admin) — service_role client, the only new admin usage
 * //   profileCache: { expire: (slug) => updateTag(profileCacheTag(slug)) } — next/cache, the tag of the cached reader
 * //   auth, rateLimiter, profiles: the same instances as the other use cases.
 * // admin.ts stays imported by container.ts only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ok } from "@/domain/shared/result";

import {
  fakeCarnetAccountEraser,
  fakeInstanceAccountRemover,
  fakeMediaFolderCleaner,
} from "../../tests/builders/account";
import { makeCallLog } from "../../tests/builders/call-log";
import { stubValidEnv } from "../../tests/builders/env";
import { fakeAuthGateway, GATEWAY_USER_EMAIL, GATEWAY_USER_ID } from "../../tests/builders/fake-auth-gateway";
import { anOwnProfile, fakeProfileReader } from "../../tests/builders/fake-profile-reader";
import { fakeRateLimiter } from "../../tests/builders/fake-rate-limiter";

const mocks = vi.hoisted(() => ({
  serverClient: { client: "server" },
  adminClient: { client: "admin" },
  updateTag: vi.fn(),
  makeSupabaseMediaFolderCleaner: vi.fn(),
  makeSupabaseCarnetAccountEraser: vi.fn(),
  makeSupabaseInstanceAccountRemover: vi.fn(),
  makeSupabaseAuthGateway: vi.fn(),
  makeSupabaseRateLimiter: vi.fn(),
  makeSupabaseProfileReader: vi.fn(),
}));

vi.mock("next/cache", () => ({
  updateTag: mocks.updateTag,
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  refresh: vi.fn(),
  unstable_cache: (callback: () => Promise<unknown>) => callback,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ getAll: () => [], get: () => undefined, has: () => false, set: vi.fn(), delete: vi.fn() }),
}));
vi.mock("@/server/infrastructure/supabase/server", () => ({ createServerSupabaseClient: async () => mocks.serverClient }));
vi.mock("@/server/infrastructure/supabase/admin", () => ({ createAdminClient: () => mocks.adminClient }));
vi.mock("@/server/infrastructure/supabase/auth-gateway", () => ({ makeSupabaseAuthGateway: mocks.makeSupabaseAuthGateway }));
vi.mock("@/server/repositories/supabase-rate-limiter", () => ({ makeSupabaseRateLimiter: mocks.makeSupabaseRateLimiter }));
vi.mock("@/server/repositories/supabase-profile-reader", () => ({ makeSupabaseProfileReader: mocks.makeSupabaseProfileReader }));
vi.mock("@/server/adapters/supabase-media-folder-cleaner", () => ({
  makeSupabaseMediaFolderCleaner: mocks.makeSupabaseMediaFolderCleaner,
}));
vi.mock("@/server/repositories/supabase-carnet-account-eraser", () => ({
  makeSupabaseCarnetAccountEraser: mocks.makeSupabaseCarnetAccountEraser,
}));
vi.mock("@/server/repositories/supabase-instance-account-remover", () => ({
  makeSupabaseInstanceAccountRemover: mocks.makeSupabaseInstanceAccountRemover,
}));

let createContainer: typeof import("@/server/container").createContainer;
let log = makeCallLog();

beforeAll(async () => {
  stubValidEnv();
  ({ createContainer } = await import("@/server/container"));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  log = makeCallLog();
  mocks.makeSupabaseAuthGateway.mockImplementation(() =>
    fakeAuthGateway({ log, currentUser: ok({ userId: GATEWAY_USER_ID, email: GATEWAY_USER_EMAIL }) }),
  );
  mocks.makeSupabaseRateLimiter.mockImplementation(() => fakeRateLimiter({ log }));
  mocks.makeSupabaseProfileReader.mockImplementation(() => fakeProfileReader({ log }));
  mocks.makeSupabaseMediaFolderCleaner.mockImplementation(() => fakeMediaFolderCleaner({ log }));
  mocks.makeSupabaseCarnetAccountEraser.mockImplementation(() => fakeCarnetAccountEraser({ log }));
  mocks.makeSupabaseInstanceAccountRemover.mockImplementation(() => fakeInstanceAccountRemover({ log }));
});

describe("createContainer — deleteAccount wiring (0023)", () => {
  it("exposes deleteAccount", async () => {
    expect(typeof (await createContainer()).deleteAccount).toBe("function");
  });

  it("Storage and SQL steps run under the session client; only the account remover gets the service_role client", async () => {
    await createContainer();

    expect(mocks.makeSupabaseMediaFolderCleaner).toHaveBeenCalledWith(mocks.serverClient);
    expect(mocks.makeSupabaseCarnetAccountEraser).toHaveBeenCalledWith(mocks.serverClient);
    expect(mocks.makeSupabaseInstanceAccountRemover).toHaveBeenCalledWith(mocks.adminClient);
    expect(mocks.makeSupabaseMediaFolderCleaner).not.toHaveBeenCalledWith(mocks.adminClient);
    expect(mocks.makeSupabaseCarnetAccountEraser).not.toHaveBeenCalledWith(mocks.adminClient);
  });

  it("criterion 1: the cached public profile is expired with updateTag('profile:<slug>') once the SQL step succeeded", async () => {
    const { deleteAccount } = await createContainer();

    expect(await deleteAccount()).toStrictEqual(ok(undefined));
    expect(mocks.updateTag).toHaveBeenCalledWith(`profile:${anOwnProfile().slug}`);
    expect(log.sequence()).toContain("instanceAccounts.remove");
  });
});
