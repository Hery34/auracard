import { isQrCode } from "@/domain/nfc/nfc-tag";
import type { QrCodeResolver } from "@/domain/nfc/ports";
import { ok, type Result } from "@/domain/shared/result";

export type ResolveQrCode = (code: string) => Promise<Result<string | null, "unexpected">>;

/** Slug targeted by `/q/{code}`, or `null`; a malformed code never reaches the database. No side effect. */
export function makeResolveQrCode(deps: { codes: QrCodeResolver }): ResolveQrCode {
  return async (code) => {
    if (!isQrCode(code)) {
      return ok(null);
    }
    return deps.codes.resolve(code);
  };
}
