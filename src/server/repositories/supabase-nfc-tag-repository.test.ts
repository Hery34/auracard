/**
 * Contract frozen by test-engineer (0025, decisions 6 and 8; 0024 decisions 5, 6 and 10).
 *
 * // src/server/repositories/supabase-nfc-tag-repository.ts — server client carrying the session (createServerSupabaseClient).
 * export function makeSupabaseNfcTagRepository(server: CarnetClient): NfcTagRepository;
 * // activate:   rpc("activate_nfc_tag", { p_uid, p_code }) → one of the five ActivationOutcome as is; any other text
 * //             → err("unexpected").
 * // listOwn:    from("nfc_tags").select(<columns listed explicitly>) — never "*", never activation_code_hash (column
 * //             privileges of 0024) — at least id, uid, status, activated_at; each row → { id, uid, status,
 * //             activatedAt }; rows whose status is neither assigned nor disabled are skipped.
 * // setEnabled: rpc("set_nfc_tag_enabled", { p_tag_id, p_enabled }) → ok(data === true).
 * // release:    rpc("release_nfc_tag", { p_tag_id }) → ok(data === true).
 * // Errors: 42501 (not a member of carnet) → err("not_member") for activate, setEnabled, release; any other error
 * //   → err("unexpected"), the code logged, never the message.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSupabaseNfcTagRepository } from "@/server/repositories/supabase-nfc-tag-repository";

import { fakeCarnetQueryClient, type FakeQueryResponse } from "../../../tests/builders/fake-carnet-query-client";
import { anOwnNfcTag, NORMALIZED_ACTIVATION_CODE, OTHER_TAG_ID, OTHER_TAG_UID, TAG_ID, TAG_UID } from "../../../tests/builders/nfc";

const PRIVATE_DETAIL = "activation_code_hash=$2a$08$abcdefghijklmnopqrstuv elodie@example.test";

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

function repository(responses: Parameters<typeof fakeCarnetQueryClient>[0]) {
  const fake = fakeCarnetQueryClient(responses);
  return { ...fake, tags: makeSupabaseNfcTagRepository(fake.client) };
}

describe("makeSupabaseNfcTagRepository — activate", () => {
  it("calls activate_nfc_tag with p_uid and p_code as given", async () => {
    const { calls, tags } = repository({ rpc: { activate_nfc_tag: { data: "activated", error: null } } });

    expect(await tags.activate(TAG_UID, NORMALIZED_ACTIVATION_CODE)).toStrictEqual(ok("activated"));
    expect(calls).toStrictEqual([
      { kind: "rpc", fn: "activate_nfc_tag", args: { p_uid: TAG_UID, p_code: NORMALIZED_ACTIVATION_CODE } },
    ]);
  });

  it.each(["activated", "already_yours", "invalid", "no_profile", "rate_limited"] as const)(
    "database answer %s → ok(%s)",
    async (outcome) => {
      const { tags } = repository({ rpc: { activate_nfc_tag: { data: outcome, error: null } } });

      expect(await tags.activate(TAG_UID, NORMALIZED_ACTIVATION_CODE)).toStrictEqual(ok(outcome));
    },
  );

  it.each([["unknown"], [""], [null]])("unknown answer %j → err('unexpected')", async (data) => {
    const { tags } = repository({ rpc: { activate_nfc_tag: { data, error: null } } });

    expect(await tags.activate(TAG_UID, NORMALIZED_ACTIVATION_CODE)).toStrictEqual(err("unexpected"));
  });

  it("42501 (not a member) → err('not_member')", async () => {
    const { tags } = repository({ rpc: { activate_nfc_tag: failure("42501") } });

    expect(await tags.activate(TAG_UID, NORMALIZED_ACTIVATION_CODE)).toStrictEqual(err("not_member"));
  });

  it("another error → err('unexpected'), only the code is logged", async () => {
    const { tags } = repository({ rpc: { activate_nfc_tag: failure("XX000") } });

    expect(await tags.activate(TAG_UID, NORMALIZED_ACTIVATION_CODE)).toStrictEqual(err("unexpected"));
    expect(logged.join("\n")).toContain("XX000");
    expect(logged.join("\n")).not.toContain("elodie@example.test");
    expect(logged.join("\n")).not.toContain("$2a$");
  });
});

describe("makeSupabaseNfcTagRepository — listOwn (decision 8)", () => {
  const ROWS = [
    { id: TAG_ID, uid: TAG_UID, status: "assigned", activated_at: "2026-11-17T10:00:00.000Z" },
    { id: OTHER_TAG_ID, uid: OTHER_TAG_UID, status: "disabled", activated_at: "2026-11-16T08:30:00.000Z" },
  ];

  it("reads carnet.nfc_tags with explicitly listed columns: never '*', never activation_code_hash", async () => {
    const { calls, tags } = repository({ tables: { nfc_tags: { data: ROWS, error: null } } });

    await tags.listOwn();

    const selects = calls.filter((call) => call.kind === "select");
    expect(selects).toHaveLength(1);
    const [select] = selects;
    expect(select?.kind === "select" && select.table).toBe("nfc_tags");
    const columns = select?.kind === "select" ? select.columns.split(",").map((column) => column.trim()) : [];
    expect(columns).toEqual(expect.arrayContaining(["id", "uid", "status", "activated_at"]));
    expect(columns).not.toContain("*");
    expect(columns.join(",")).not.toContain("*");
    expect(columns.join(",")).not.toContain("activation_code_hash");
  });

  it("maps each row to { id, uid, status, activatedAt }", async () => {
    const { tags } = repository({ tables: { nfc_tags: { data: ROWS, error: null } } });

    expect(await tags.listOwn()).toStrictEqual(
      ok([
        anOwnNfcTag(),
        anOwnNfcTag({ id: OTHER_TAG_ID, uid: OTHER_TAG_UID, status: "disabled", activatedAt: "2026-11-16T08:30:00.000Z" }),
      ]),
    );
  });

  it("a row whose status is neither assigned nor disabled is skipped", async () => {
    const { tags } = repository({
      tables: { nfc_tags: { data: [...ROWS, { id: "x", uid: "zzzzzzzzzzzz", status: "stock", activated_at: null }], error: null } },
    });

    const result = await tags.listOwn();

    expect(result.ok && result.value.map((tag) => tag.uid)).toStrictEqual([TAG_UID, OTHER_TAG_UID]);
  });

  it("no row → ok([])", async () => {
    const { tags } = repository({ tables: { nfc_tags: { data: [], error: null } } });

    expect(await tags.listOwn()).toStrictEqual(ok([]));
  });

  it("error → err('unexpected'), only the code is logged", async () => {
    const { tags } = repository({ tables: { nfc_tags: failure("42501") } });

    expect(await tags.listOwn()).toStrictEqual(err("unexpected"));
    expect(logged.join("\n")).not.toContain("elodie@example.test");
  });
});

describe("makeSupabaseNfcTagRepository — setEnabled and release", () => {
  it.each([false, true])("setEnabled(tagId, %s) calls set_nfc_tag_enabled(p_tag_id, p_enabled)", async (enabled) => {
    const { calls, tags } = repository({ rpc: { set_nfc_tag_enabled: { data: true, error: null } } });

    expect(await tags.setEnabled(TAG_ID, enabled)).toStrictEqual(ok(true));
    expect(calls).toStrictEqual([{ kind: "rpc", fn: "set_nfc_tag_enabled", args: { p_tag_id: TAG_ID, p_enabled: enabled } }]);
  });

  it("setEnabled: false (absent or someone else's) → ok(false)", async () => {
    const { tags } = repository({ rpc: { set_nfc_tag_enabled: { data: false, error: null } } });

    expect(await tags.setEnabled(TAG_ID, false)).toStrictEqual(ok(false));
  });

  it("release calls release_nfc_tag(p_tag_id) → ok(true)", async () => {
    const { calls, tags } = repository({ rpc: { release_nfc_tag: { data: true, error: null } } });

    expect(await tags.release(TAG_ID)).toStrictEqual(ok(true));
    expect(calls).toStrictEqual([{ kind: "rpc", fn: "release_nfc_tag", args: { p_tag_id: TAG_ID } }]);
  });

  it("release: false (already released, absent or someone else's) → ok(false)", async () => {
    const { tags } = repository({ rpc: { release_nfc_tag: { data: false, error: null } } });

    expect(await tags.release(TAG_ID)).toStrictEqual(ok(false));
  });

  it.each([
    ["set_nfc_tag_enabled", (tags: ReturnType<typeof makeSupabaseNfcTagRepository>) => tags.setEnabled(TAG_ID, true)],
    ["release_nfc_tag", (tags: ReturnType<typeof makeSupabaseNfcTagRepository>) => tags.release(TAG_ID)],
  ] as const)("%s: 42501 → err('not_member'), another error → err('unexpected')", async (fn, call) => {
    expect(await call(repository({ rpc: { [fn]: failure("42501") } }).tags)).toStrictEqual(err("not_member"));
    expect(await call(repository({ rpc: { [fn]: failure("XX000") } }).tags)).toStrictEqual(err("unexpected"));
    expect(logged.join("\n")).not.toContain("elodie@example.test");
  });
});
