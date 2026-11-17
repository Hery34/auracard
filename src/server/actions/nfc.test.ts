/**
 * Contract frozen by test-engineer (0025, decisions 5, 6 and 8; ADR 0012).
 *
 * // src/server/actions/nfc.ts — "use server"
 * export type ActivateNfcTagActionError = "invalid_input" | "invalid" | "rate_limited" | "no_profile" | "unexpected";
 * export type ActivateNfcTagState = { status: "idle" } | { status: "error"; error: ActivateNfcTagActionError };
 * // Fields: `uid` (hidden field of /activer/{uid}) and `code` (« Code d'activation »).
 * // uid not isNfcTagUid, or code not a string / longer than ACTIVATION_CODE_INPUT_MAX_LENGTH → invalid_input before
 * // createContainer. Then activateNfcTag({ uid, code, clientAddress: requestClientAddress(await headers()) }):
 * //   ok("activated" | "already_yours") → redirect("/tableau-de-bord/puces");
 * //   err("unauthenticated") → redirect to /connexion with suivant=/activer/{uid} (query encoded or not);
 * //   any other error → { status: "error", error } as is. No submitted value (code, uid) in the returned state.
 * export async function activateNfcTagAction(previous: ActivateNfcTagState, formData: FormData): Promise<ActivateNfcTagState>;
 *
 * export type NfcTagActionError = "invalid_input" | "not_found" | "rate_limited" | "unexpected";
 * export type NfcTagActionState = { status: "idle" } | { status: "error"; error: NfcTagActionError } | { status: "saved" };
 * // Fields: `tagId` (uuid) and `enabled` ("true" | "false"). Anything else → invalid_input before createContainer.
 * export async function setNfcTagEnabledAction(previous: NfcTagActionState, formData: FormData): Promise<NfcTagActionState>;
 * // Field: `tagId` (uuid). The confirmation is asked by the page before submitting.
 * export async function releaseNfcTagAction(previous: NfcTagActionState, formData: FormData): Promise<NfcTagActionState>;
 * // Both: err("unauthenticated") → redirect("/connexion"); success → { status: "saved" } after refreshing
 * // /tableau-de-bord/puces (revalidatePath("/tableau-de-bord/puces") or refresh() of next/cache); errors as is.
 *
 * // src/server/container.ts — Container gains activateNfcTag: ActivateNfcTag, listOwnNfcTags: ListOwnNfcTags,
 * //   setNfcTagEnabled: SetNfcTagEnabled, releaseNfcTag: ReleaseNfcTag (server client under session; the rate
 * //   limiter on the service_role client as for the other actions; membership via makeSupabaseMembershipReader).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import type { ActivateNfcTagState, NfcTagActionState } from "@/server/actions/nfc";

import { stubValidEnv } from "../../../tests/builders/env";
import { ACTIVATION_CODE, MALFORMED_TAG_UIDS, TAG_ID, TAG_UID } from "../../../tests/builders/nfc";

const mocks = vi.hoisted(() => ({
  createContainer: vi.fn(),
  activateNfcTag: vi.fn(),
  setNfcTagEnabled: vi.fn(),
  releaseNfcTag: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  refresh: vi.fn(),
  updateTag: vi.fn(),
  forwardedFor: { value: "203.0.113.9" },
}));

vi.mock("@/server/container", () => ({ createContainer: mocks.createContainer }));

vi.mock("next/navigation", () => ({
  redirect: (...args: [url: string, type?: string]): never => {
    const [url] = args;
    mocks.redirect(...args);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": mocks.forwardedFor.value }),
  cookies: async () => ({ getAll: () => [], get: () => undefined, has: () => false, set: vi.fn(), delete: vi.fn() }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  refresh: mocks.refresh,
  updateTag: mocks.updateTag,
  revalidateTag: vi.fn(),
}));

const MY_TAGS_PATH = "/tableau-de-bord/puces";
const idleActivation: ActivateNfcTagState = { status: "idle" };
const idle: NfcTagActionState = { status: "idle" };

function form(fields: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) {
      data.set(name, value);
    }
  }
  return data;
}

function redirectedTo(): string {
  const [url] = (mocks.redirect.mock.calls[0] ?? []) as [string?];
  return url ?? "";
}

/** True when the list of « Mes puces » was refreshed after a write. */
function myTagsRefreshed(): boolean {
  return mocks.revalidatePath.mock.calls.some(([path]) => path === MY_TAGS_PATH) || mocks.refresh.mock.calls.length > 0;
}

let actions: typeof import("@/server/actions/nfc");

beforeAll(async () => {
  stubValidEnv();
  actions = await import("@/server/actions/nfc");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.forwardedFor.value = "203.0.113.9";
  mocks.createContainer.mockImplementation(async () => ({
    activateNfcTag: mocks.activateNfcTag,
    setNfcTagEnabled: mocks.setNfcTagEnabled,
    releaseNfcTag: mocks.releaseNfcTag,
  }));
  mocks.activateNfcTag.mockResolvedValue(ok("activated"));
  mocks.setNfcTagEnabled.mockResolvedValue(ok(undefined));
  mocks.releaseNfcTag.mockResolvedValue(ok(undefined));
});

describe("activateNfcTagAction (decision 6)", () => {
  it("criterion 2: passes uid, code as typed and the client address (last x-forwarded-for element), then redirect('/tableau-de-bord/puces')", async () => {
    mocks.forwardedFor.value = "198.51.100.7, 203.0.113.9";

    await expect(actions.activateNfcTagAction(idleActivation, form({ uid: TAG_UID, code: ACTIVATION_CODE }))).rejects.toThrow(
      `NEXT_REDIRECT:${MY_TAGS_PATH}`,
    );

    expect(mocks.activateNfcTag).toHaveBeenCalledTimes(1);
    expect(mocks.activateNfcTag).toHaveBeenCalledWith({ uid: TAG_UID, code: ACTIVATION_CODE, clientAddress: "203.0.113.9" });
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    expect(redirectedTo()).toBe(MY_TAGS_PATH);
  });

  it("criterion 2 (replay): already_yours → the same redirection, no error", async () => {
    mocks.activateNfcTag.mockResolvedValueOnce(ok("activated")).mockResolvedValueOnce(ok("already_yours"));
    const data = () => form({ uid: TAG_UID, code: ACTIVATION_CODE });

    await expect(actions.activateNfcTagAction(idleActivation, data())).rejects.toThrow(`NEXT_REDIRECT:${MY_TAGS_PATH}`);
    await expect(actions.activateNfcTagAction(idleActivation, data())).rejects.toThrow(`NEXT_REDIRECT:${MY_TAGS_PATH}`);

    expect(mocks.redirect.mock.calls.map(([url]) => url)).toStrictEqual([MY_TAGS_PATH, MY_TAGS_PATH]);
  });

  it.each(["abcde-fgh23", "abcdefgh23", "ABCDEFGH23"])(
    "criterion 2: the code %s reaches the use case unchanged (normalization belongs to the use case)",
    async (code) => {
      await expect(actions.activateNfcTagAction(idleActivation, form({ uid: TAG_UID, code }))).rejects.toThrow("NEXT_REDIRECT");

      expect(mocks.activateNfcTag).toHaveBeenCalledWith(expect.objectContaining({ uid: TAG_UID, code }));
    },
  );

  it.each(["invalid", "rate_limited", "no_profile", "unexpected"] as const)(
    "criteria 3: use case error %s → { status: 'error', error } as is, no redirection",
    async (error) => {
      mocks.activateNfcTag.mockResolvedValue(err(error));

      expect(await actions.activateNfcTagAction(idleActivation, form({ uid: TAG_UID, code: ACTIVATION_CODE }))).toStrictEqual({
        status: "error",
        error,
      });
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );

  it("criterion 2: no session (unauthenticated) → /connexion?suivant=/activer/{uid}", async () => {
    mocks.activateNfcTag.mockResolvedValue(err("unauthenticated"));

    await expect(actions.activateNfcTagAction(idleActivation, form({ uid: TAG_UID, code: ACTIVATION_CODE }))).rejects.toThrow(
      "NEXT_REDIRECT:/connexion",
    );

    const target = new URL(redirectedTo(), "https://carnet.example");
    expect(target.origin).toBe("https://carnet.example");
    expect(target.pathname).toBe("/connexion");
    expect([...target.searchParams.keys()]).toStrictEqual(["suivant"]);
    expect(target.searchParams.get("suivant")).toBe(`/activer/${TAG_UID}`);
    expect(redirectedTo()).toBe(`/connexion?suivant=%2Factiver%2F${TAG_UID}`);
  });

  it.each(MALFORMED_TAG_UIDS)("uid with %s → invalid_input before the container", async (_label, uid) => {
    expect(await actions.activateNfcTagAction(idleActivation, form({ uid, code: ACTIVATION_CODE }))).toStrictEqual({
      status: "error",
      error: "invalid_input",
    });
    expect(mocks.createContainer).not.toHaveBeenCalled();
  });

  it.each([
    ["no uid", { code: ACTIVATION_CODE }],
    ["no code", { uid: TAG_UID }],
    ["a code of 33 characters", { uid: TAG_UID, code: "A".repeat(33) }],
  ])("%s → invalid_input before the container", async (_label, fields) => {
    expect(await actions.activateNfcTagAction(idleActivation, form(fields))).toStrictEqual({
      status: "error",
      error: "invalid_input",
    });
    expect(mocks.createContainer).not.toHaveBeenCalled();
  });

  it("a file instead of the code → invalid_input before the container", async () => {
    const data = form({ uid: TAG_UID });
    data.set("code", new File([ACTIVATION_CODE], "code.txt"));

    expect(await actions.activateNfcTagAction(idleActivation, data)).toStrictEqual({ status: "error", error: "invalid_input" });
    expect(mocks.createContainer).not.toHaveBeenCalled();
  });

  it("a code of exactly 32 characters still reaches the use case (its answer is invalid)", async () => {
    mocks.activateNfcTag.mockResolvedValue(err("invalid"));

    expect(await actions.activateNfcTagAction(idleActivation, form({ uid: TAG_UID, code: "A".repeat(32) }))).toStrictEqual({
      status: "error",
      error: "invalid",
    });
  });

  it("no submitted value in the returned state: neither the code nor the uid", async () => {
    mocks.activateNfcTag.mockResolvedValue(err("invalid"));

    const states = [
      await actions.activateNfcTagAction(idleActivation, form({ uid: TAG_UID, code: "SECRT-CODE9" })),
      await actions.activateNfcTagAction(idleActivation, form({ uid: "<script>", code: "SECRT-CODE9" })),
    ];

    for (const state of states) {
      const serialized = JSON.stringify(state);
      expect(serialized).not.toContain("SECRT");
      expect(serialized).not.toContain(TAG_UID);
      expect(serialized).not.toContain("<script>");
    }
  });
});

describe("setNfcTagEnabledAction (decision 8)", () => {
  it.each([
    ["false", false],
    ["true", true],
  ] as const)("criterion 5: enabled=%s → setNfcTagEnabled({ tagId, enabled }) → saved, « Mes puces » refreshed", async (raw, enabled) => {
    expect(await actions.setNfcTagEnabledAction(idle, form({ tagId: TAG_ID, enabled: raw }))).toStrictEqual({ status: "saved" });

    expect(mocks.setNfcTagEnabled).toHaveBeenCalledWith({ tagId: TAG_ID, enabled });
    expect(myTagsRefreshed()).toBe(true);
  });

  it.each([
    ["no tagId", { enabled: "false" }],
    ["a tagId that is not a uuid", { tagId: "42", enabled: "false" }],
    ["a uid instead of the tag id", { tagId: TAG_UID, enabled: "false" }],
    ["no enabled", { tagId: TAG_ID }],
    ["enabled = 'on'", { tagId: TAG_ID, enabled: "on" }],
    ["enabled = 'TRUE'", { tagId: TAG_ID, enabled: "TRUE" }],
  ])("%s → invalid_input before the container", async (_label, fields) => {
    expect(await actions.setNfcTagEnabledAction(idle, form(fields))).toStrictEqual({ status: "error", error: "invalid_input" });
    expect(mocks.createContainer).not.toHaveBeenCalled();
  });

  it.each(["not_found", "rate_limited", "unexpected"] as const)("use case error %s → as is, nothing refreshed", async (error) => {
    mocks.setNfcTagEnabled.mockResolvedValue(err(error));

    expect(await actions.setNfcTagEnabledAction(idle, form({ tagId: TAG_ID, enabled: "false" }))).toStrictEqual({
      status: "error",
      error,
    });
    expect(myTagsRefreshed()).toBe(false);
  });

  it("unauthenticated → redirect('/connexion')", async () => {
    mocks.setNfcTagEnabled.mockResolvedValue(err("unauthenticated"));

    await expect(actions.setNfcTagEnabledAction(idle, form({ tagId: TAG_ID, enabled: "false" }))).rejects.toThrow(
      "NEXT_REDIRECT:/connexion",
    );
    expect(new URL(redirectedTo(), "https://carnet.example").pathname).toBe("/connexion");
  });

  it("idempotence: submitted twice → saved twice", async () => {
    const first = await actions.setNfcTagEnabledAction(idle, form({ tagId: TAG_ID, enabled: "false" }));
    const second = await actions.setNfcTagEnabledAction(idle, form({ tagId: TAG_ID, enabled: "false" }));

    expect(second).toStrictEqual(first);
    expect(mocks.setNfcTagEnabled).toHaveBeenCalledTimes(2);
  });
});

describe("releaseNfcTagAction (decision 8)", () => {
  it("criterion 5: releaseNfcTag(tagId) → saved, « Mes puces » refreshed", async () => {
    expect(await actions.releaseNfcTagAction(idle, form({ tagId: TAG_ID }))).toStrictEqual({ status: "saved" });

    expect(mocks.releaseNfcTag).toHaveBeenCalledWith(TAG_ID);
    expect(myTagsRefreshed()).toBe(true);
  });

  it("idempotence: submitted twice (the second release finds nothing to do) → saved twice", async () => {
    const first = await actions.releaseNfcTagAction(idle, form({ tagId: TAG_ID }));
    const second = await actions.releaseNfcTagAction(idle, form({ tagId: TAG_ID }));

    expect(first).toStrictEqual({ status: "saved" });
    expect(second).toStrictEqual(first);
  });

  it.each([
    ["no tagId", {}],
    ["a tagId that is not a uuid", { tagId: "1 or 1=1" }],
  ])("%s → invalid_input before the container", async (_label, fields) => {
    expect(await actions.releaseNfcTagAction(idle, form(fields))).toStrictEqual({ status: "error", error: "invalid_input" });
    expect(mocks.createContainer).not.toHaveBeenCalled();
  });

  it.each(["not_found", "rate_limited", "unexpected"] as const)("use case error %s → as is, nothing refreshed", async (error) => {
    mocks.releaseNfcTag.mockResolvedValue(err(error));

    expect(await actions.releaseNfcTagAction(idle, form({ tagId: TAG_ID }))).toStrictEqual({ status: "error", error });
    expect(myTagsRefreshed()).toBe(false);
  });

  it("unauthenticated → redirect('/connexion')", async () => {
    mocks.releaseNfcTag.mockResolvedValue(err("unauthenticated"));

    await expect(actions.releaseNfcTagAction(idle, form({ tagId: TAG_ID }))).rejects.toThrow("NEXT_REDIRECT:/connexion");
  });
});
