/**
 * Contract frozen by test-engineer (0023, decision 2, step 2).
 *
 * // src/server/repositories/supabase-carnet-account-eraser.ts — server client carrying the session.
 * export function makeSupabaseCarnetAccountEraser(server: CarnetClient): CarnetAccountEraser;
 * // erase(): rpc("delete_own_account") without argument (the caller is auth.uid()) → ok(data) where data is the text
 * // returned (slug of the deleted profile) or null (replay, no profile). Any other type of data → err("unexpected").
 * // Any error → err("unexpected"), the code logged, never the message nor the details.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSupabaseCarnetAccountEraser } from "@/server/repositories/supabase-carnet-account-eraser";

import { fakeCarnetQueryClient, type FakeQueryResponse } from "../../../tests/builders/fake-carnet-query-client";

const PRIVATE_DETAIL = "profile 9f1c2d3e owned by elodie@example.test";

function failure(code: string): FakeQueryResponse {
  return { data: null, error: { code, message: PRIVATE_DETAIL, details: PRIVATE_DETAIL, hint: null } };
}

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

describe("makeSupabaseCarnetAccountEraser", () => {
  it("decision 2: calls delete_own_account with no identifier → ok(slug of the deleted profile)", async () => {
    const { client, calls } = fakeCarnetQueryClient({ rpc: { delete_own_account: { data: "elodie-martin", error: null } } });

    expect(await makeSupabaseCarnetAccountEraser(client).erase()).toStrictEqual(ok("elodie-martin"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: "rpc", fn: "delete_own_account" });
    const args = calls[0]?.kind === "rpc" ? calls[0].args : undefined;
    expect(args === undefined || (typeof args === "object" && args !== null && Object.keys(args).length === 0)).toBe(true);
  });

  it("criterion 3: replay or no profile (null returned) → ok(null), twice", async () => {
    const { client, calls } = fakeCarnetQueryClient({ rpc: { delete_own_account: { data: null, error: null } } });
    const eraser = makeSupabaseCarnetAccountEraser(client);

    expect(await eraser.erase()).toStrictEqual(ok(null));
    expect(await eraser.erase()).toStrictEqual(ok(null));
    expect(calls).toHaveLength(2);
  });

  it.each([
    ["undefined", undefined],
    ["a number", 42],
    ["a boolean", true],
    ["an object", { slug: "elodie-martin" }],
    ["an array", ["elodie-martin"]],
  ])("data of another type (%s) → err('unexpected')", async (_label, data) => {
    const { client } = fakeCarnetQueryClient({ rpc: { delete_own_account: { data, error: null } } });

    expect(await makeSupabaseCarnetAccountEraser(client).erase()).toStrictEqual(err("unexpected"));
  });

  it.each(["42501", "PGRST301", "57014"])("error %s → err('unexpected'), code logged, message never", async (code) => {
    const { client } = fakeCarnetQueryClient({ rpc: { delete_own_account: failure(code) } });

    expect(await makeSupabaseCarnetAccountEraser(client).erase()).toStrictEqual(err("unexpected"));
    expect(logged.join("\n")).toContain(code);
    expect(logged.join("\n")).not.toContain(PRIVATE_DETAIL);
  });
});
