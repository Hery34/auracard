/**
 * Contract frozen by test-engineer (0025, decisions 1 and 2; 0024 decision 6).
 *
 * // src/server/repositories/supabase-nfc-tag-resolver.ts — cookie-less anonymous client (createPublicSupabaseClient).
 * export function makeSupabaseNfcTagResolver(client: CarnetClient): NfcTagResolver;
 * // rpc("resolve_nfc_tag", { p_uid: uid }) → one row (state, slug):
 * //   active + slug → { state: "active", slug }; activation → { state: "activation" }; not_found → { state: "not_found" };
 * //   no row → not_found; unknown state or active without slug → err("unexpected"); error → err("unexpected"), code logged.
 *
 * // src/server/repositories/supabase-qr-code-resolver.ts — same client.
 * export function makeSupabaseQrCodeResolver(client: CarnetClient): QrCodeResolver;
 * // rpc("resolve_qr_code", { p_code: code }) → slug (string) or null; error → err("unexpected"), code logged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSupabaseNfcTagResolver } from "@/server/repositories/supabase-nfc-tag-resolver";
import { makeSupabaseQrCodeResolver } from "@/server/repositories/supabase-qr-code-resolver";

import { fakeCarnetQueryClient, type FakeQueryResponse } from "../../../tests/builders/fake-carnet-query-client";
import { QR_CODE, TAG_UID } from "../../../tests/builders/nfc";

const SLUG = "elodie-durand-merel";
const PRIVATE_DETAIL = "Key (uid)=(7k2m9p4q8r3s) row: elodie@example.test";
const FAILURE: FakeQueryResponse = {
  data: null,
  error: { code: "PGRST000", message: PRIVATE_DETAIL, details: PRIVATE_DETAIL, hint: null },
};

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

function nfcResolver(response: FakeQueryResponse) {
  const fake = fakeCarnetQueryClient({ rpc: { resolve_nfc_tag: response } });
  return { ...fake, resolver: makeSupabaseNfcTagResolver(fake.client) };
}

function qrResolver(response: FakeQueryResponse) {
  const fake = fakeCarnetQueryClient({ rpc: { resolve_qr_code: response } });
  return { ...fake, resolver: makeSupabaseQrCodeResolver(fake.client) };
}

describe("makeSupabaseNfcTagResolver", () => {
  it("calls resolve_nfc_tag with p_uid only", async () => {
    const { calls, resolver } = nfcResolver({ data: [{ state: "not_found", slug: null }], error: null });

    await resolver.resolve(TAG_UID);

    expect(calls).toStrictEqual([{ kind: "rpc", fn: "resolve_nfc_tag", args: { p_uid: TAG_UID } }]);
  });

  it("active + slug → { state: 'active', slug }", async () => {
    const { resolver } = nfcResolver({ data: [{ state: "active", slug: SLUG }], error: null });

    expect(await resolver.resolve(TAG_UID)).toStrictEqual(ok({ state: "active", slug: SLUG }));
  });

  it("activation → { state: 'activation' } (no slug)", async () => {
    const { resolver } = nfcResolver({ data: [{ state: "activation", slug: null }], error: null });

    expect(await resolver.resolve(TAG_UID)).toStrictEqual(ok({ state: "activation" }));
  });

  it("not_found → { state: 'not_found' }", async () => {
    const { resolver } = nfcResolver({ data: [{ state: "not_found", slug: null }], error: null });

    expect(await resolver.resolve(TAG_UID)).toStrictEqual(ok({ state: "not_found" }));
  });

  it("no row → { state: 'not_found' }", async () => {
    const { resolver } = nfcResolver({ data: [], error: null });

    expect(await resolver.resolve(TAG_UID)).toStrictEqual(ok({ state: "not_found" }));
  });

  it.each([
    ["an unknown state", [{ state: "stock", slug: null }]],
    ["active without slug", [{ state: "active", slug: null }]],
  ])("%s → err('unexpected')", async (_label, data) => {
    const { resolver } = nfcResolver({ data, error: null });

    expect(await resolver.resolve(TAG_UID)).toStrictEqual(err("unexpected"));
  });

  it("database error → err('unexpected'), only the code is logged", async () => {
    const { resolver } = nfcResolver(FAILURE);

    expect(await resolver.resolve(TAG_UID)).toStrictEqual(err("unexpected"));
    expect(logged.join("\n")).toContain("PGRST000");
    expect(logged.join("\n")).not.toContain("elodie@example.test");
  });
});

describe("makeSupabaseQrCodeResolver", () => {
  it("calls resolve_qr_code with p_code only and returns the slug", async () => {
    const { calls, resolver } = qrResolver({ data: SLUG, error: null });

    expect(await resolver.resolve(QR_CODE)).toStrictEqual(ok(SLUG));
    expect(calls).toStrictEqual([{ kind: "rpc", fn: "resolve_qr_code", args: { p_code: QR_CODE } }]);
  });

  it("null (unknown code or unpublished profile) → ok(null)", async () => {
    const { resolver } = qrResolver({ data: null, error: null });

    expect(await resolver.resolve(QR_CODE)).toStrictEqual(ok(null));
  });

  it("database error → err('unexpected'), only the code is logged", async () => {
    const { resolver } = qrResolver(FAILURE);

    expect(await resolver.resolve(QR_CODE)).toStrictEqual(err("unexpected"));
    expect(logged.join("\n")).toContain("PGRST000");
    expect(logged.join("\n")).not.toContain("elodie@example.test");
  });
});
