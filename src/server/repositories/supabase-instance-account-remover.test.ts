/**
 * Contract frozen by test-engineer (0023, decision 2, step 3; ADR 0011 amendment of 17/11/2026).
 *
 * // src/server/repositories/supabase-instance-account-remover.ts — service_role client, injected by the container
 * // (admin.ts stays imported by src/server/container.ts only: the ESLint rule needs no new exception).
 * export function makeSupabaseInstanceAccountRemover(admin: CarnetClient): InstanceAccountRemover;
 * // isOrphan(userId): rpc("is_orphan_account", { p_user_id: userId }) → data true/false → ok(data); data not a boolean
 * //   → err("unexpected"); error → err("unexpected") (code logged).
 * // remove(userId): auth.admin.deleteUser(userId) — hard delete (no second argument, or false) → ok(undefined);
 * //   404 / user_not_found (already deleted) → ok(undefined); any other error → err("unexpected"), the code or status
 * //   logged, never the message.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSupabaseInstanceAccountRemover } from "@/server/repositories/supabase-instance-account-remover";

import { fakeSupabaseAdminAccounts, userNotFound, type FakeSupabaseAdminAccountsOptions } from "../../../tests/builders/account";
import { GATEWAY_USER_ID } from "../../../tests/builders/fake-auth-gateway";
import { authApiError, retryableFetchError } from "../../../tests/builders/fake-supabase-auth";

const PRIVATE_DETAIL = "user elodie@example.test";

let logged: string[] = [];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function remover(options: FakeSupabaseAdminAccountsOptions = {}) {
  const fake = fakeSupabaseAdminAccounts(options);
  return { ...fake, accounts: makeSupabaseInstanceAccountRemover(fake.client) };
}

describe("makeSupabaseInstanceAccountRemover — isOrphan", () => {
  it.each([true, false])("is_orphan_account answers %s → ok(%s)", async (answer) => {
    const { accounts, calls } = remover({ isOrphan: { data: answer, error: null } });

    expect(await accounts.isOrphan(GATEWAY_USER_ID)).toStrictEqual(ok(answer));
    expect(calls).toStrictEqual([{ kind: "rpc", fn: "is_orphan_account", args: { p_user_id: GATEWAY_USER_ID } }]);
  });

  it.each([null, "true", 1])("a non-boolean answer (%s) → err('unexpected'), never treated as orphan", async (data) => {
    const { accounts } = remover({ isOrphan: { data, error: null } });

    expect(await accounts.isOrphan(GATEWAY_USER_ID)).toStrictEqual(err("unexpected"));
  });

  it("error → err('unexpected'), code logged, message never", async () => {
    const { accounts } = remover({
      isOrphan: { data: null, error: { code: "42501", message: PRIVATE_DETAIL, details: PRIVATE_DETAIL, hint: null } },
    });

    expect(await accounts.isOrphan(GATEWAY_USER_ID)).toStrictEqual(err("unexpected"));
    expect(logged.join("\n")).toContain("42501");
    expect(logged.join("\n")).not.toContain(PRIVATE_DETAIL);
  });
});

describe("makeSupabaseInstanceAccountRemover — remove", () => {
  it("criterion 2: deleteUser(userId) as a hard delete → ok", async () => {
    const { accounts, calls } = remover();

    expect(await accounts.remove(GATEWAY_USER_ID)).toStrictEqual(ok(undefined));
    const deletions = calls.filter((call) => call.kind === "deleteUser");
    expect(deletions).toHaveLength(1);
    const [args] = deletions.map((call) => (call.kind === "deleteUser" ? call.args : []));
    expect(args?.[0]).toBe(GATEWAY_USER_ID);
    expect(args?.[1] === undefined || args[1] === false).toBe(true);
  });

  it("criterion 3: account already absent (404 user_not_found) → ok (ADR 0011 amendment)", async () => {
    const { accounts } = remover({ deleteUser: { error: userNotFound() } });

    expect(await accounts.remove(GATEWAY_USER_ID)).toStrictEqual(ok(undefined));
  });

  it("criterion 3: executed twice (deleted, then 404) → ok twice", async () => {
    const first = remover();
    const second = remover({ deleteUser: { error: userNotFound() } });

    expect(await first.accounts.remove(GATEWAY_USER_ID)).toStrictEqual(ok(undefined));
    expect(await second.accounts.remove(GATEWAY_USER_ID)).toStrictEqual(ok(undefined));
  });

  it.each([
    ["GoTrue 500", authApiError("unexpected_failure", 500, PRIVATE_DETAIL)],
    ["GoTrue 403 (bad key)", authApiError("not_admin", 403, PRIVATE_DETAIL)],
    ["network failure", retryableFetchError()],
  ])("%s → err('unexpected'), never the message logged", async (_label, error) => {
    const { accounts } = remover({ deleteUser: { error } });

    expect(await accounts.remove(GATEWAY_USER_ID)).toStrictEqual(err("unexpected"));
    expect(logged).toHaveLength(1);
    expect(logged.join("\n")).not.toContain(PRIVATE_DETAIL);
  });
});
