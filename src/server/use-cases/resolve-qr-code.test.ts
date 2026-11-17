/**
 * Contract frozen by test-engineer (0025, decision 2). Port: QrCodeResolver (see src/domain/nfc/nfc-tag.test.ts).
 *
 * // src/server/use-cases/resolve-qr-code.ts
 * export type ResolveQrCode = (code: string) => Promise<Result<string | null, "unexpected">>;  // slug or null
 * export function makeResolveQrCode(deps: { codes: QrCodeResolver }): ResolveQrCode;
 * // code outside QR_CODE_PATTERN → ok(null) without calling the port; else the port's answer as is.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeResolveQrCode } from "@/server/use-cases/resolve-qr-code";

import { makeCallLog } from "../../../tests/builders/call-log";
import { fakeQrCodeResolver, type QrResolutionResult } from "../../../tests/builders/fake-nfc-tag-resolver";
import { MALFORMED_QR_CODES, QR_CODE } from "../../../tests/builders/nfc";

function harness(results?: readonly QrResolutionResult[]) {
  const log = makeCallLog();
  const resolveQrCode = makeResolveQrCode({ codes: fakeQrCodeResolver({ log, results }) });
  return { log, resolveQrCode };
}

describe("resolveQrCode", () => {
  it("criterion 1: a QR code of a published profile → ok(slug)", async () => {
    const { log, resolveQrCode } = harness([ok("elodie-durand-merel")]);

    expect(await resolveQrCode(QR_CODE)).toStrictEqual(ok("elodie-durand-merel"));
    expect(log.inputsOf("qrCodes", "resolve")).toStrictEqual([QR_CODE]);
  });

  it("criterion 1: unknown code or unpublished profile → ok(null)", async () => {
    const { resolveQrCode } = harness([ok(null)]);

    expect(await resolveQrCode(QR_CODE)).toStrictEqual(ok(null));
  });

  it.each(MALFORMED_QR_CODES)("criterion 1: code with %s → ok(null) without any database request", async (_label, code) => {
    const { log, resolveQrCode } = harness([ok("should-never-be-read")]);

    expect(await resolveQrCode(code)).toStrictEqual(ok(null));
    expect(log.sequence()).toStrictEqual([]);
  });

  it("a database failure → err('unexpected')", async () => {
    const { resolveQrCode } = harness([err("unexpected")]);

    expect(await resolveQrCode(QR_CODE)).toStrictEqual(err("unexpected"));
  });
});
