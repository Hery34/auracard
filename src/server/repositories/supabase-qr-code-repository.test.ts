/**
 * Contract frozen by test-engineer (0026, decisions 1 and 7; 0024: ensure_qr_code and set_qr_style).
 *
 * // src/server/repositories/supabase-qr-code-repository.ts — server client carrying the session (createServerSupabaseClient).
 * export function makeSupabaseQrCodeRepository(server: CarnetClient): QrCodeRepository;
 * // ensureOwn: rpc("ensure_qr_code") (no argument) → the returned row → ok({ code, style: { fg, bg, logo } }).
 * // setStyle:  rpc("set_qr_style", { p_style: { fg, bg, logo } }) — exactly these three keys — → ok({ code, style }).
 * // The row is narrowed: code not isQrCode, or style not { fg: isQrColor, bg: isQrColor, logo: boolean } → err("unexpected")
 * //   (logged). Only `code` and `style` leave the adapter (never id, profile_id, dates).
 * // Errors: 42501 (no profile of the caller, or not a member of carnet) → err("no_profile"); 22023 (set_qr_style:
 * //   invalid style) → err("invalid"); any other error → err("unexpected"), the code logged, never the message.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSupabaseQrCodeRepository } from "@/server/repositories/supabase-qr-code-repository";

import { fakeCarnetQueryClient, type FakeQueryResponse } from "../../../tests/builders/fake-carnet-query-client";
import { anOwnQrCode, aQrStyle, BRANDED_QR_STYLE, QR_CODE } from "../../../tests/builders/qr";

const PRIVATE_DETAIL = "profile 9f1c2d3e owned by elodie@example.test";

const ROW = {
  id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
  code: QR_CODE,
  profile_id: "9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
  style: { fg: "#000000", bg: "#ffffff", logo: false },
  created_at: "2026-11-17T10:00:00.000Z",
  updated_at: "2026-11-17T10:00:00.000Z",
};

function row(overrides: Record<string, unknown> = {}): FakeQueryResponse {
  return { data: { ...ROW, ...overrides }, error: null };
}

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
  return { ...fake, qrCodes: makeSupabaseQrCodeRepository(fake.client) };
}

const MALFORMED_ROWS: ReadonlyArray<readonly [label: string, overrides: Record<string, unknown>]> = [
  ["a code outside the format", { code: "X4Y5Z6W7" }],
  ["a style that is not an object", { style: "black" }],
  ["a style without logo", { style: { fg: "#000000", bg: "#ffffff" } }],
  ["an upper-case colour", { style: { fg: "#FFFFFF", bg: "#000000", logo: false } }],
  ["a logo that is not a boolean", { style: { fg: "#000000", bg: "#ffffff", logo: "true" } }],
];

describe("makeSupabaseQrCodeRepository — ensureOwn (decision 1)", () => {
  it("calls ensure_qr_code and maps the row to { code, style }", async () => {
    const { calls, qrCodes } = repository({ rpc: { ensure_qr_code: row() } });

    expect(await qrCodes.ensureOwn()).toStrictEqual(ok(anOwnQrCode()));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: "rpc", fn: "ensure_qr_code" });
  });

  it("only code and style leave the adapter", async () => {
    const { qrCodes } = repository({ rpc: { ensure_qr_code: row({ style: BRANDED_QR_STYLE }) } });

    const result = await qrCodes.ensureOwn();

    expect(result).toStrictEqual(ok({ code: QR_CODE, style: BRANDED_QR_STYLE }));
    expect(JSON.stringify(result)).not.toContain(ROW.profile_id);
  });

  it("criterion 7: 42501 (no profile, account of another project) → err('no_profile')", async () => {
    const { qrCodes } = repository({ rpc: { ensure_qr_code: failure("42501") } });

    expect(await qrCodes.ensureOwn()).toStrictEqual(err("no_profile"));
  });

  it("another error (23505: generation exhausted) → err('unexpected'), only the code is logged", async () => {
    const { qrCodes } = repository({ rpc: { ensure_qr_code: failure("23505") } });

    expect(await qrCodes.ensureOwn()).toStrictEqual(err("unexpected"));
    expect(logged.join("\n")).toContain("23505");
    expect(logged.join("\n")).not.toContain("elodie@example.test");
  });

  it.each(MALFORMED_ROWS)("a row with %s → err('unexpected')", async (_label, overrides) => {
    const { qrCodes } = repository({ rpc: { ensure_qr_code: row(overrides) } });

    expect(await qrCodes.ensureOwn()).toStrictEqual(err("unexpected"));
  });

  it("no row → err('unexpected')", async () => {
    const { qrCodes } = repository({ rpc: { ensure_qr_code: { data: null, error: null } } });

    expect(await qrCodes.ensureOwn()).toStrictEqual(err("unexpected"));
  });
});

describe("makeSupabaseQrCodeRepository — setStyle (decision 7)", () => {
  it("calls set_qr_style with p_style = { fg, bg, logo } and maps the returned row", async () => {
    const { calls, qrCodes } = repository({ rpc: { set_qr_style: row({ style: BRANDED_QR_STYLE }) } });

    expect(await qrCodes.setStyle(BRANDED_QR_STYLE)).toStrictEqual(ok(anOwnQrCode({ style: BRANDED_QR_STYLE })));
    expect(calls).toStrictEqual([{ kind: "rpc", fn: "set_qr_style", args: { p_style: BRANDED_QR_STYLE } }]);
  });

  it("sends exactly the three keys of the style, nothing else", async () => {
    const { calls, qrCodes } = repository({ rpc: { set_qr_style: row() } });
    const withExtra = { ...aQrStyle(), profile_id: ROW.profile_id } as ReturnType<typeof aQrStyle>;

    await qrCodes.setStyle(withExtra);

    const [call] = calls;
    expect(call?.kind === "rpc" && call.args).toStrictEqual({ p_style: aQrStyle() });
  });

  it("22023 (invalid style) → err('invalid')", async () => {
    const { qrCodes } = repository({ rpc: { set_qr_style: failure("22023") } });

    expect(await qrCodes.setStyle(BRANDED_QR_STYLE)).toStrictEqual(err("invalid"));
  });

  it("criterion 7: 42501 → err('no_profile')", async () => {
    const { qrCodes } = repository({ rpc: { set_qr_style: failure("42501") } });

    expect(await qrCodes.setStyle(BRANDED_QR_STYLE)).toStrictEqual(err("no_profile"));
  });

  it("another error → err('unexpected'), only the code is logged", async () => {
    const { qrCodes } = repository({ rpc: { set_qr_style: failure("XX000") } });

    expect(await qrCodes.setStyle(BRANDED_QR_STYLE)).toStrictEqual(err("unexpected"));
    expect(logged.join("\n")).toContain("XX000");
    expect(logged.join("\n")).not.toContain("elodie@example.test");
  });

  it.each(MALFORMED_ROWS)("a returned row with %s → err('unexpected')", async (_label, overrides) => {
    const { qrCodes } = repository({ rpc: { set_qr_style: row(overrides) } });

    expect(await qrCodes.setStyle(BRANDED_QR_STYLE)).toStrictEqual(err("unexpected"));
  });
});
