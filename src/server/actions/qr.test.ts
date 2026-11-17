/**
 * Contract frozen by test-engineer (0026, decisions 4, 5 and 7; criteria 2, 5 and 7; same shape as 0021 and 0025).
 *
 * // src/server/actions/qr.ts — "use server"
 * export type SaveQrStyleActionError = "invalid_input" | Exclude<SaveQrStyleError, "unauthenticated">;
 * //   i.e. "invalid_input" | "invalid_color" | "not_darker" | "low_contrast" | "rate_limited" | "no_profile" | "invalid"
 * //   | "unexpected"
 * export type SaveQrStyleState = { status: "idle" } | { status: "error"; error: SaveQrStyleActionError } | { status: "saved" };
 * export async function saveQrStyleAction(previous: SaveQrStyleState, formData: FormData): Promise<SaveQrStyleState>;
 * // Fields (read through textFields of form-fields.ts, parsed by a Zod schema in src/server/actions/qr-schemas.ts):
 * //   `fg` and `bg` (« Couleur des modules », « Couleur du fond »): strings, required — the colour rule itself is the
 * //     domain's, so "#FFFFFF" reaches the use case, which answers invalid_color;
 * //   `logo` (checkbox « Ajouter mon logo au centre »): absent → false, "on" → true, any other value → invalid_input.
 * //   Missing fg/bg, a File, or a bad logo value → invalid_input before createContainer.
 * // Then saveQrStyle({ fg, bg, logo }) of the container:
 * //   ok → { status: "saved" } after refreshing /tableau-de-bord/qr (revalidatePath("/tableau-de-bord/qr") or refresh());
 * //   err("unauthenticated") → redirect("/connexion"); any other error → { status: "error", error } as is, nothing refreshed.
 *
 * // src/server/container.ts — Container gains getOwnQrCode: GetOwnQrCode (siteUrl: env.SITE_URL) and
 * //   saveQrStyle: SaveQrStyle (makeSupabaseQrCodeRepository on the server client under session; the rate limiter on the
 * //   service_role client as for the other actions).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import type { SaveQrStyleState } from "@/server/actions/qr";

import { stubValidEnv } from "../../../tests/builders/env";
import { aQrStyle, BRANDED_QR_STYLE } from "../../../tests/builders/qr";

const mocks = vi.hoisted(() => ({
  createContainer: vi.fn(),
  saveQrStyle: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  refresh: vi.fn(),
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
  headers: async () => new Headers(),
  cookies: async () => ({ getAll: () => [], get: () => undefined, has: () => false, set: vi.fn(), delete: vi.fn() }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  refresh: mocks.refresh,
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
}));

const QR_PATH = "/tableau-de-bord/qr";
const idle: SaveQrStyleState = { status: "idle" };

function form(fields: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) {
      data.set(name, value);
    }
  }
  return data;
}

function qrPageRefreshed(): boolean {
  return mocks.revalidatePath.mock.calls.some(([path]) => path === QR_PATH) || mocks.refresh.mock.calls.length > 0;
}

let actions: typeof import("@/server/actions/qr");

beforeAll(async () => {
  stubValidEnv();
  actions = await import("@/server/actions/qr");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createContainer.mockImplementation(async () => ({ saveQrStyle: mocks.saveQrStyle }));
  mocks.saveQrStyle.mockResolvedValue(ok(undefined));
});

describe("saveQrStyleAction (decision 7)", () => {
  it("decision 7: fg, bg and the checked logo → saveQrStyle({ fg, bg, logo: true }) → saved, the QR page refreshed", async () => {
    const state = await actions.saveQrStyleAction(idle, form({ fg: BRANDED_QR_STYLE.fg, bg: BRANDED_QR_STYLE.bg, logo: "on" }));

    expect(state).toStrictEqual({ status: "saved" });
    expect(mocks.saveQrStyle).toHaveBeenCalledTimes(1);
    expect(mocks.saveQrStyle).toHaveBeenCalledWith(BRANDED_QR_STYLE);
    expect(qrPageRefreshed()).toBe(true);
  });

  it("an unchecked logo (field absent) → logo: false", async () => {
    await actions.saveQrStyleAction(idle, form({ fg: "#000000", bg: "#ffffff" }));

    expect(mocks.saveQrStyle).toHaveBeenCalledWith(aQrStyle({ logo: false }));
  });

  it("idempotence: the same style submitted twice → saved twice", async () => {
    const data = () => form({ fg: "#000000", bg: "#ffffff" });

    const first = await actions.saveQrStyleAction(idle, data());
    const second = await actions.saveQrStyleAction(idle, data());

    expect(first).toStrictEqual({ status: "saved" });
    expect(second).toStrictEqual(first);
    expect(mocks.saveQrStyle).toHaveBeenCalledTimes(2);
  });

  it("criterion 2: an upper-case colour reaches the use case unchanged (the colour rule belongs to the domain)", async () => {
    mocks.saveQrStyle.mockResolvedValue(err("invalid_color"));

    expect(await actions.saveQrStyleAction(idle, form({ fg: "#FFFFFF", bg: "#000000" }))).toStrictEqual({
      status: "error",
      error: "invalid_color",
    });
    expect(mocks.saveQrStyle).toHaveBeenCalledWith(aQrStyle({ fg: "#FFFFFF", bg: "#000000" }));
  });

  it.each(["not_darker", "low_contrast", "invalid_color", "invalid", "no_profile", "rate_limited", "unexpected"] as const)(
    "criteria 2 and 7: use case error %s → { status: 'error', error } as is, nothing refreshed, no redirection",
    async (error) => {
      mocks.saveQrStyle.mockResolvedValue(err(error));

      expect(await actions.saveQrStyleAction(idle, form({ fg: "#ffffff", bg: "#000000" }))).toStrictEqual({
        status: "error",
        error,
      });
      expect(qrPageRefreshed()).toBe(false);
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );

  it("criterion 5: the action checks the session itself: unauthenticated → redirect('/connexion')", async () => {
    mocks.saveQrStyle.mockResolvedValue(err("unauthenticated"));

    await expect(actions.saveQrStyleAction(idle, form({ fg: "#000000", bg: "#ffffff" }))).rejects.toThrow(
      "NEXT_REDIRECT:/connexion",
    );
    const [url] = (mocks.redirect.mock.calls[0] ?? []) as [string?];
    expect(new URL(url ?? "", "https://carnet.example").pathname).toBe("/connexion");
    expect(qrPageRefreshed()).toBe(false);
  });

  it.each([
    ["no fg", { bg: "#ffffff" }],
    ["no bg", { fg: "#000000" }],
    ["nothing", {}],
    ["logo = 'true'", { fg: "#000000", bg: "#ffffff", logo: "true" }],
    ["logo = 'off'", { fg: "#000000", bg: "#ffffff", logo: "off" }],
    ["logo = ''", { fg: "#000000", bg: "#ffffff", logo: "" }],
  ])("%s → invalid_input before the container", async (_label, fields) => {
    expect(await actions.saveQrStyleAction(idle, form(fields))).toStrictEqual({ status: "error", error: "invalid_input" });
    expect(mocks.createContainer).not.toHaveBeenCalled();
  });

  it("a file instead of a colour → invalid_input before the container", async () => {
    const data = form({ bg: "#ffffff" });
    data.set("fg", new File(["#000000"], "fg.txt"));

    expect(await actions.saveQrStyleAction(idle, data)).toStrictEqual({ status: "error", error: "invalid_input" });
    expect(mocks.createContainer).not.toHaveBeenCalled();
  });
});
