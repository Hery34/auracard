/**
 * Contract frozen by test-engineer (0023, decisions 1 to 3; ADR 0012).
 *
 * // src/server/actions/account.ts — "use server"
 * export type DeleteAccountActionError = "invalid_confirmation" | "rate_limited" | "unexpected";
 * export type DeleteAccountState = { status: "idle" } | { status: "error"; error: DeleteAccountActionError };
 * // Field `confirmation`. Not isAccountDeletionConfirmed (absent, any other value) → { status: "error",
 * //   error: "invalid_confirmation" } before createContainer: nothing deleted, nothing read.
 * // Then deleteAccount() (no argument: the account is the session's):
 * //   err("unauthenticated") → EVERY "sb-*" cookie deleted (stale session of an account already gone), then
 * //     redirect("/connexion");
 * //   err("rate_limited" | "unexpected") → { status: "error", error } as is, the session kept;
 * //   ok → auth.signOut() (local scope; a failure is logged through the existing logger — one JSON line, code only,
 * //   never a message — and changes nothing), then EVERY cookie whose name starts with "sb-" deleted
 * //   (chunks included, other cookies kept), then redirect("/?compte=supprime", "replace"). The home page shows
 * //   « Votre compte a été supprimé. » for `compte=supprime`.
 * // No submitted value in the returned state.
 * export async function deleteAccountAction(previous: DeleteAccountState, formData: FormData): Promise<DeleteAccountState>;
 *
 * // src/server/container.ts — Container gains `deleteAccount: DeleteAccount` (see container-account.test.ts).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import type { DeleteAccountState } from "@/server/actions/account";

import { DELETION_CONFIRMATION } from "../../../tests/builders/account";
import { stubValidEnv } from "../../../tests/builders/env";

const mocks = vi.hoisted(() => ({
  createContainer: vi.fn(),
  deleteAccount: vi.fn(),
  signOut: vi.fn(),
  redirect: vi.fn(),
  requestCookies: { value: [] as Array<{ name: string; value: string }> },
  deleteCookie: vi.fn(),
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
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
  cookies: async () => ({
    getAll: () => mocks.requestCookies.value,
    get: (name: string) => mocks.requestCookies.value.find((cookie) => cookie.name === name),
    has: (name: string) => mocks.requestCookies.value.some((cookie) => cookie.name === name),
    set: vi.fn(),
    delete: mocks.deleteCookie,
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  refresh: vi.fn(),
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
}));

const HOME_AFTER_DELETION = "/?compte=supprime";
const SIGN_IN_PATH = "/connexion";
const idle: DeleteAccountState = { status: "idle" };

const SESSION_COOKIES = [
  { name: "sb-127-auth-token", value: "base64-session" },
  { name: "sb-127-auth-token.0", value: "chunk-0" },
  { name: "sb-127-auth-token.1", value: "chunk-1" },
];
const OTHER_COOKIES = [
  { name: "theme", value: "dark" },
  { name: "xsb-not-a-session", value: "x" },
];

function form(confirmation: string | undefined): FormData {
  const data = new FormData();
  if (confirmation !== undefined) {
    data.set("confirmation", confirmation);
  }
  return data;
}

/** `cookies().delete` accepts a name or `{ name, ...options }`. */
function deletedCookieNames(): string[] {
  return mocks.deleteCookie.mock.calls.map(([target]) =>
    typeof target === "string" ? target : (target as { name: string }).name,
  );
}

let actions: typeof import("@/server/actions/account");
let logged: string[] = [];

beforeAll(async () => {
  stubValidEnv();
  actions = await import("@/server/actions/account");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requestCookies.value = [...SESSION_COOKIES, ...OTHER_COOKIES];
  mocks.createContainer.mockImplementation(async () => ({
    deleteAccount: mocks.deleteAccount,
    auth: { signOut: mocks.signOut, signUp: vi.fn(), signIn: vi.fn(), currentUser: vi.fn() },
  }));
  mocks.deleteAccount.mockResolvedValue(ok(undefined));
  mocks.signOut.mockResolvedValue(ok(undefined));
  logged = [];
  const capture = (line: unknown) => {
    logged.push(String(line));
  };
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deleteAccountAction", () => {
  describe("criterion 4: confirmation", () => {
    it.each([
      ["absent", undefined],
      ["empty", ""],
      ["in lower case", "supprimer"],
      ["with a trailing space", "SUPPRIMER "],
      ["another word", "OUI"],
    ])("confirmation %s → invalid_confirmation, container never built, nothing deleted", async (_label, confirmation) => {
      expect(await actions.deleteAccountAction(idle, form(confirmation))).toStrictEqual({
        status: "error",
        error: "invalid_confirmation",
      });
      expect(mocks.createContainer).not.toHaveBeenCalled();
      expect(mocks.deleteAccount).not.toHaveBeenCalled();
      expect(mocks.deleteCookie).not.toHaveBeenCalled();
      expect(mocks.redirect).not.toHaveBeenCalled();
    });

    it("a file submitted as confirmation → invalid_confirmation", async () => {
      const data = new FormData();
      data.set("confirmation", new Blob([DELETION_CONFIRMATION]), "confirmation.txt");

      expect(await actions.deleteAccountAction(idle, data)).toStrictEqual({ status: "error", error: "invalid_confirmation" });
      expect(mocks.deleteAccount).not.toHaveBeenCalled();
    });
  });

  describe("criteria 1 and 6: deletion, sign-out, home page", () => {
    it("SUPPRIMER → deleteAccount() without argument, signOut, every sb-* cookie deleted, redirect('/?compte=supprime', 'replace')", async () => {
      await expect(actions.deleteAccountAction(idle, form(DELETION_CONFIRMATION))).rejects.toThrow(
        `NEXT_REDIRECT:${HOME_AFTER_DELETION}`,
      );

      expect(mocks.deleteAccount).toHaveBeenCalledTimes(1);
      expect(mocks.deleteAccount).toHaveBeenCalledWith();
      expect(mocks.signOut).toHaveBeenCalledTimes(1);
      expect(deletedCookieNames().sort()).toStrictEqual(SESSION_COOKIES.map((cookie) => cookie.name).sort());
      expect(mocks.redirect).toHaveBeenCalledTimes(1);
      expect(mocks.redirect).toHaveBeenCalledWith(HOME_AFTER_DELETION, "replace");
    });

    it("order: deletion, then sign-out, then cookies, then redirection", async () => {
      await expect(actions.deleteAccountAction(idle, form(DELETION_CONFIRMATION))).rejects.toThrow("NEXT_REDIRECT");

      const deleted = mocks.deleteAccount.mock.invocationCallOrder[0] ?? 0;
      const signedOut = mocks.signOut.mock.invocationCallOrder[0] ?? 0;
      const firstCookie = Math.min(...mocks.deleteCookie.mock.invocationCallOrder);
      const lastCookie = Math.max(...mocks.deleteCookie.mock.invocationCallOrder);
      const redirected = mocks.redirect.mock.invocationCallOrder[0] ?? 0;
      expect(deleted).toBeLessThan(signedOut);
      expect(signedOut).toBeLessThan(firstCookie);
      expect(lastCookie).toBeLessThan(redirected);
    });

    it("signOut fails (account already gone at GoTrue) → cookies still deleted, same redirection", async () => {
      mocks.signOut.mockResolvedValue(err("unexpected"));

      await expect(actions.deleteAccountAction(idle, form(DELETION_CONFIRMATION))).rejects.toThrow(
        `NEXT_REDIRECT:${HOME_AFTER_DELETION}`,
      );
      expect(deletedCookieNames().sort()).toStrictEqual(SESSION_COOKIES.map((cookie) => cookie.name).sort());
    });

    it("signOut fails → one log line (existing logger: level, source, code 'unexpected', eventId), nothing else", async () => {
      mocks.signOut.mockResolvedValue(err("unexpected"));

      await expect(actions.deleteAccountAction(idle, form(DELETION_CONFIRMATION))).rejects.toThrow("NEXT_REDIRECT");

      expect(logged).toHaveLength(1);
      const line = JSON.parse(logged[0] ?? "{}") as Record<string, unknown>;
      expect(Object.keys(line).sort()).toStrictEqual(["code", "eventId", "level", "source"]);
      expect(line.code).toBe("unexpected");
      expect(["warn", "error"]).toContain(line.level);
    });

    it("signOut succeeds → nothing logged", async () => {
      await expect(actions.deleteAccountAction(idle, form(DELETION_CONFIRMATION))).rejects.toThrow("NEXT_REDIRECT");

      expect(logged).toStrictEqual([]);
    });

    it("criterion 3: submitted twice (double click) → the same redirection twice, no error", async () => {
      const submit = () => actions.deleteAccountAction(idle, form(DELETION_CONFIRMATION));

      await expect(submit()).rejects.toThrow(`NEXT_REDIRECT:${HOME_AFTER_DELETION}`);
      mocks.requestCookies.value = [...OTHER_COOKIES];
      await expect(submit()).rejects.toThrow(`NEXT_REDIRECT:${HOME_AFTER_DELETION}`);

      expect(mocks.redirect.mock.calls.map(([url]) => url)).toStrictEqual([HOME_AFTER_DELETION, HOME_AFTER_DELETION]);
    });
  });

  describe("criterion 5 and errors", () => {
    it("no session (unauthenticated) → redirect('/connexion'), no sign-out needed", async () => {
      mocks.deleteAccount.mockResolvedValue(err("unauthenticated"));

      await expect(actions.deleteAccountAction(idle, form(DELETION_CONFIRMATION))).rejects.toThrow(`NEXT_REDIRECT:${SIGN_IN_PATH}`);
      expect(mocks.redirect.mock.calls[0]?.[0]).toBe(SIGN_IN_PATH);
    });

    it("unauthenticated (stale session after a completed deletion) → every sb-* cookie deleted, others kept, BEFORE redirect('/connexion')", async () => {
      mocks.deleteAccount.mockResolvedValue(err("unauthenticated"));

      await expect(actions.deleteAccountAction(idle, form(DELETION_CONFIRMATION))).rejects.toThrow(`NEXT_REDIRECT:${SIGN_IN_PATH}`);

      expect(deletedCookieNames().sort()).toStrictEqual(SESSION_COOKIES.map((cookie) => cookie.name).sort());
      const lastCookie = Math.max(...mocks.deleteCookie.mock.invocationCallOrder);
      expect(lastCookie).toBeLessThan(mocks.redirect.mock.invocationCallOrder[0] ?? 0);
    });

    it.each(["rate_limited", "unexpected"] as const)("%s → error state as is, session kept (no sign-out, no cookie deleted)", async (error) => {
      mocks.deleteAccount.mockResolvedValue(err(error));

      expect(await actions.deleteAccountAction(idle, form(DELETION_CONFIRMATION))).toStrictEqual({ status: "error", error });
      expect(mocks.signOut).not.toHaveBeenCalled();
      expect(mocks.deleteCookie).not.toHaveBeenCalled();
      expect(mocks.redirect).not.toHaveBeenCalled();
    });

    it("no submitted value is echoed in the returned state", async () => {
      const state = await actions.deleteAccountAction(idle, form("supprimer-moi"));

      expect(JSON.stringify(state)).not.toContain("supprimer-moi");
    });
  });
});
