import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import type { ActionState } from "@/server/actions/auth";
import {
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  registerSchema,
  signInSchema,
} from "@/server/actions/auth-schemas";

import { GATEWAY_USER_ID } from "../../../tests/builders/fake-auth-gateway";
import { PROFILE_ID } from "../../../tests/builders/fake-registrar";
import { stubValidEnv } from "../../../tests/builders/env";

const mocks = vi.hoisted(() => ({
  registerUser: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  redirect: vi.fn(),
  forwardedFor: { value: "203.0.113.9" },
  requestCookies: { value: [] as Array<{ name: string; value: string }> },
  deleteCookie: vi.fn(),
}));

vi.mock("@/server/container", () => ({
  createContainer: async () => ({
    registerUser: mocks.registerUser,
    signIn: mocks.signIn,
    auth: { signOut: mocks.signOut, signUp: vi.fn(), signIn: vi.fn(), currentUser: vi.fn() },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: [url: string, type?: string]): never => {
    const [url] = args;
    mocks.redirect(...args);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": mocks.forwardedFor.value }),
  cookies: async () => ({
    getAll: () => mocks.requestCookies.value,
    get: (name: string) => mocks.requestCookies.value.find((cookie) => cookie.name === name),
    has: (name: string) => mocks.requestCookies.value.some((cookie) => cookie.name === name),
    set: vi.fn(),
    delete: mocks.deleteCookie,
  }),
}));

/** `cookies().delete` accepts a name or `{ name, ...options }`. */
function deletedCookieNames(): string[] {
  return mocks.deleteCookie.mock.calls.map(([target]) =>
    typeof target === "string" ? target : (target as { name: string }).name,
  );
}

const idle: ActionState = { status: "idle" };
const INVALID_INPUT = { status: "error", error: "invalid_input" };

const validRegister = {
  email: "elodie@example.test",
  password: "correct horse battery staple",
  displayName: "Élodie Durand-Mérel",
};
const validSignIn = { email: "elodie@example.test", password: "correct horse battery staple" };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

function without<T extends Record<string, string>>(fields: T, name: keyof T): Record<string, string> {
  const copy: Record<string, string> = { ...fields };
  delete copy[name as string];
  return copy;
}

let actions: typeof import("@/server/actions/auth");

beforeAll(async () => {
  stubValidEnv();
  actions = await import("@/server/actions/auth");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.forwardedFor.value = "203.0.113.9";
  mocks.requestCookies.value = [];
  mocks.registerUser.mockResolvedValue(ok({ profileId: PROFILE_ID, needsEmailConfirmation: false }));
  mocks.signIn.mockResolvedValue(ok({ userId: GATEWAY_USER_ID, joined: false }));
  mocks.signOut.mockResolvedValue(ok(undefined));
});

describe("registerAction", () => {
  it.each([
    ["an empty e-mail", { ...validRegister, email: "" }],
    ["a malformed e-mail", { ...validRegister, email: "not-an-email" }],
    ["an e-mail of 255 characters", { ...validRegister, email: `${"a".repeat(242)}@example.test` }],
    ["a missing e-mail", without(validRegister, "email")],
    ["a password of 7 characters", { ...validRegister, password: "1234567" }],
    ["a password of 73 characters", { ...validRegister, password: "p".repeat(73) }],
    ["a missing password", without(validRegister, "password")],
    ["an empty display name", { ...validRegister, displayName: "" }],
    ["a blank display name", { ...validRegister, displayName: "   " }],
    ["a display name of 81 characters", { ...validRegister, displayName: "n".repeat(81) }],
    ["a display name with a control character", { ...validRegister, displayName: "Élodie\u0007" }],
    ["a display name with a right-to-left override (U+202E)", { ...validRegister, displayName: "Élodie\u202E" }],
    ["a display name with a zero-width space (U+200B)", { ...validRegister, displayName: "Élo\u200Bdie" }],
    ["a missing display name", without(validRegister, "displayName")],
  ])("criterion 8: %s → { status: 'error', error: 'invalid_input' } without calling the use case", async (_label, fields) => {
    expect(await actions.registerAction(idle, form(fields))).toMatchObject(INVALID_INPUT);
    expect(mocks.registerUser).not.toHaveBeenCalled();
  });

  it("passes the validated input (trimmed display name) and the client address taken from the last x-forwarded-for element", async () => {
    mocks.forwardedFor.value = "198.51.100.7, 203.0.113.9";

    await expect(
      actions.registerAction(idle, form({ ...validRegister, displayName: "  Élodie Durand-Mérel  " })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.registerUser).toHaveBeenCalledTimes(1);
    expect(mocks.registerUser).toHaveBeenCalledWith({
      email: validRegister.email,
      password: validRegister.password,
      displayName: "Élodie Durand-Mérel",
      clientAddress: "203.0.113.9",
    });
  });

  it("accepts a display name of exactly 80 characters and a password of exactly 8 and 72 characters", async () => {
    await expect(
      actions.registerAction(idle, form({ ...validRegister, displayName: "n".repeat(80), password: "12345678" })),
    ).rejects.toThrow("NEXT_REDIRECT");
    await expect(
      actions.registerAction(idle, form({ ...validRegister, password: "p".repeat(72) })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.registerUser).toHaveBeenCalledTimes(2);
  });

  it("criterion 8: success with a session → redirect('/tableau-de-bord')", async () => {
    await expect(actions.registerAction(idle, form(validRegister))).rejects.toThrow("NEXT_REDIRECT:/tableau-de-bord");

    expect(mocks.redirect).toHaveBeenCalledWith("/tableau-de-bord");
  });

  it("criterion 8: success without a session → { status: 'check_email' } and no redirect", async () => {
    // Option (a): without a session the use case writes nothing and answers without profileId.
    mocks.registerUser.mockResolvedValue(ok({ needsEmailConfirmation: true }));

    expect(await actions.registerAction(idle, form(validRegister))).toStrictEqual({ status: "check_email" });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each(["rate_limited", "email_taken", "weak_password", "slug_unavailable", "registration_closed", "unexpected"] as const)(
    "maps the use case error %s as is",
    async (error) => {
      mocks.registerUser.mockResolvedValue(err(error));

      expect(await actions.registerAction(idle, form(validRegister))).toMatchObject({ status: "error", error });
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );
});

describe("signInAction", () => {
  it.each([
    ["an empty e-mail", { ...validSignIn, email: "" }],
    ["a malformed e-mail", { ...validSignIn, email: "not-an-email" }],
    ["an empty password", { ...validSignIn, password: "" }],
    ["a password of 73 characters", { ...validSignIn, password: "p".repeat(73) }],
    ["a missing password", without(validSignIn, "password")],
    ["a display name of 81 characters", { ...validSignIn, displayName: "n".repeat(81) }],
    ["a display name with a control character", { ...validSignIn, displayName: "Élodie\u0007" }],
    ["a display name with a right-to-left override (U+202E)", { ...validSignIn, displayName: "Élodie\u202E" }],
    ["a display name with a zero-width space (U+200B)", { ...validSignIn, displayName: "Élo\u200Bdie" }],
  ])("criterion 8: %s → { status: 'error', error: 'invalid_input' } without calling the use case", async (_label, fields) => {
    expect(await actions.signInAction(idle, form(fields))).toMatchObject(INVALID_INPUT);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("passes the credentials and the client address, without a display name when the form has none", async () => {
    await expect(actions.signInAction(idle, form(validSignIn))).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.signIn).toHaveBeenCalledTimes(1);
    const [input] = mocks.signIn.mock.calls[0] as [Record<string, unknown>];
    expect(input).toMatchObject({ email: validSignIn.email, password: validSignIn.password, clientAddress: "203.0.113.9" });
    expect(input.displayName).toBeUndefined();
  });

  it("passes the trimmed display name when the form provides one (account joining carnet)", async () => {
    mocks.signIn.mockResolvedValue(ok({ userId: GATEWAY_USER_ID, joined: true }));

    await expect(
      actions.signInAction(idle, form({ ...validSignIn, displayName: "  Élodie Durand-Mérel  " })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.signIn).toHaveBeenCalledWith({
      email: validSignIn.email,
      password: validSignIn.password,
      displayName: "Élodie Durand-Mérel",
      clientAddress: "203.0.113.9",
    });
  });

  it("criterion 8: success → redirect('/tableau-de-bord')", async () => {
    await expect(actions.signInAction(idle, form(validSignIn))).rejects.toThrow("NEXT_REDIRECT:/tableau-de-bord");

    expect(mocks.redirect).toHaveBeenCalledWith("/tableau-de-bord");
  });

  it.each([
    "rate_limited",
    "invalid_credentials",
    "display_name_required",
    "slug_unavailable",
    "registration_closed",
    "unexpected",
  ] as const)("maps the use case error %s as is", async (error) => {
    mocks.signIn.mockResolvedValue(err(error));

    expect(await actions.signInAction(idle, form(validSignIn))).toMatchObject({ status: "error", error });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("signOutAction", () => {
  it("criterion 5: calls auth.signOut then redirect('/connexion', 'replace') (no history entry for the dashboard)", async () => {
    await expect(actions.signOutAction()).rejects.toThrow("NEXT_REDIRECT:/connexion");

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).toHaveBeenCalledWith("/connexion", "replace");
    expect(mocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(mocks.redirect.mock.invocationCallOrder[0] ?? 0);
  });

  it("criterion 5: auth.signOut fails (unexpected) → every sb-* cookie is still deleted, other cookies kept, then redirect('/connexion', 'replace')", async () => {
    mocks.signOut.mockResolvedValue(err("unexpected"));
    mocks.requestCookies.value = [
      { name: "sb-127-auth-token", value: "base64-session" },
      { name: "sb-127-auth-token.0", value: "chunk-0" },
      { name: "sb-127-auth-token.1", value: "chunk-1" },
      { name: "theme", value: "dark" },
      { name: "xsb-not-a-session", value: "x" },
    ];

    await expect(actions.signOutAction()).rejects.toThrow("NEXT_REDIRECT:/connexion");

    expect(deletedCookieNames().sort()).toStrictEqual(["sb-127-auth-token", "sb-127-auth-token.0", "sb-127-auth-token.1"]);
    expect(mocks.redirect).toHaveBeenCalledWith("/connexion", "replace");
    const lastDeletion = Math.max(...mocks.deleteCookie.mock.invocationCallOrder);
    expect(lastDeletion).toBeLessThan(mocks.redirect.mock.invocationCallOrder[0] ?? 0);
  });

  it("criterion 5: signing out twice after a failure deletes the cookies again and redirects each time (replayable)", async () => {
    mocks.signOut.mockResolvedValue(err("unexpected"));
    mocks.requestCookies.value = [{ name: "sb-127-auth-token", value: "base64-session" }];

    await expect(actions.signOutAction()).rejects.toThrow("NEXT_REDIRECT:/connexion");
    mocks.requestCookies.value = [];
    await expect(actions.signOutAction()).rejects.toThrow("NEXT_REDIRECT:/connexion");

    expect(deletedCookieNames()).toStrictEqual(["sb-127-auth-token"]);
    expect(mocks.redirect).toHaveBeenNthCalledWith(2, "/connexion", "replace");
  });
});

describe("auth-schemas (shared with the 0008 forms)", () => {
  const FORBIDDEN_DISPLAY_NAMES: Array<[string, string]> = [
    ["a control character (U+0007)", "Élodie\u0007"],
    ["a right-to-left override (U+202E)", "Élodie\u202E"],
    ["a zero-width space (U+200B)", "Élo\u200Bdie"],
    ["a zero-width joiner (U+200D)", "Élo\u200Ddie"],
    ["a soft hyphen (U+00AD)", "Élo\u00ADdie"],
    ["0022 decision 9: a line separator (U+2028)", "Élodie\u2028Durand"],
    ["0022 decision 9: a paragraph separator (U+2029)", "Élodie\u2029Durand"],
  ];

  it.each(FORBIDDEN_DISPLAY_NAMES)("registerSchema refuses a display name with %s", (_label, displayName) => {
    expect(registerSchema.safeParse({ ...validRegister, displayName }).success).toBe(false);
  });

  it.each(FORBIDDEN_DISPLAY_NAMES)("signInSchema refuses a provided display name with %s", (_label, displayName) => {
    expect(signInSchema.safeParse({ ...validSignIn, displayName }).success).toBe(false);
  });

  it("registerSchema accepts and trims a plain display name with diacritics and a hyphen", () => {
    const parsed = registerSchema.safeParse({ ...validRegister, displayName: "  Élodie Durand-Mérel  " });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.displayName).toBe("Élodie Durand-Mérel");
  });

  it("exports the bounds reused by the forms: PASSWORD_MIN_LENGTH 8, PASSWORD_MAX_LENGTH 72, EMAIL_MAX_LENGTH 254, DISPLAY_NAME_MAX_LENGTH 80", () => {
    expect({ PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, EMAIL_MAX_LENGTH, DISPLAY_NAME_MAX_LENGTH }).toStrictEqual({
      PASSWORD_MIN_LENGTH: 8,
      PASSWORD_MAX_LENGTH: 72,
      EMAIL_MAX_LENGTH: 254,
      DISPLAY_NAME_MAX_LENGTH: 80,
    });
  });

  it.each(["123456", "1234567"])(
    "signInSchema accepts a password of %s (6 or 7 characters: accounts of other projects of the instance, GoTrue minimum)",
    (password) => {
      expect(signInSchema.safeParse({ ...validSignIn, password }).success).toBe(true);
    },
  );

  it("signInSchema still refuses an empty password", () => {
    expect(signInSchema.safeParse({ ...validSignIn, password: "" }).success).toBe(false);
  });

  it("signInSchema refuses a password longer than PASSWORD_MAX_LENGTH", () => {
    expect(signInSchema.safeParse({ ...validSignIn, password: "p".repeat(PASSWORD_MAX_LENGTH + 1) }).success).toBe(false);
  });

  it("registerSchema keeps PASSWORD_MIN_LENGTH: 7 characters refused, 8 accepted", () => {
    expect(registerSchema.safeParse({ ...validRegister, password: "p".repeat(PASSWORD_MIN_LENGTH - 1) }).success).toBe(false);
    expect(registerSchema.safeParse({ ...validRegister, password: "p".repeat(PASSWORD_MIN_LENGTH) }).success).toBe(true);
  });

  it("signInSchema accepts a missing display name", () => {
    const parsed = signInSchema.safeParse(validSignIn);

    expect(parsed.success).toBe(true);
    expect(parsed.data?.displayName).toBeUndefined();
  });
});
