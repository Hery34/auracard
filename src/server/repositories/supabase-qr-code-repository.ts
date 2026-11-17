import { isQrCode } from "@/domain/nfc/nfc-tag";
import type { OwnQrCode, QrCodeRepository } from "@/domain/qr/ports";
import { isQrColor, type QrStyle } from "@/domain/qr/qr-style";
import { err, ok, type Result } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

const INSUFFICIENT_PRIVILEGE = "42501";
const INVALID_PARAMETER_VALUE = "22023";

type PostgrestFailure = { code: string };

/**
 * `ensure_qr_code` and `set_qr_style` (0024) under the session of the server client: only the caller's QR. The row is
 * narrowed (the generated types say `string` and `Json`); only `code` and `style` leave the adapter.
 */
export function makeSupabaseQrCodeRepository(server: CarnetClient): QrCodeRepository {
  return {
    async ensureOwn() {
      const { data, error } = await server.rpc("ensure_qr_code");
      if (error !== null) {
        return error.code === INSUFFICIENT_PRIVILEGE ? err("no_profile") : unexpected("ensure_qr_code", error);
      }
      return ownQrCode("ensure_qr_code", data);
    },

    async setStyle({ fg, bg, logo }) {
      const { data, error } = await server.rpc("set_qr_style", { p_style: { fg, bg, logo } });
      if (error !== null) {
        if (error.code === INSUFFICIENT_PRIVILEGE) {
          return err("no_profile");
        }
        return error.code === INVALID_PARAMETER_VALUE ? err("invalid") : unexpected("set_qr_style", error);
      }
      return ownQrCode("set_qr_style", data);
    },
  };
}

function ownQrCode(source: string, row: unknown): Result<OwnQrCode, "unexpected"> {
  if (typeof row !== "object" || row === null || !("code" in row) || !("style" in row)) {
    logInfrastructureError(source, "no_row");
    return err("unexpected");
  }
  const { code, style } = row;
  if (!isQrCode(code) || !isQrStyle(style)) {
    logInfrastructureError(source, "malformed_row");
    return err("unexpected");
  }
  return ok({ code, style: { fg: style.fg, bg: style.bg, logo: style.logo } });
}

function isQrStyle(value: unknown): value is QrStyle {
  return (
    typeof value === "object" &&
    value !== null &&
    "fg" in value &&
    "bg" in value &&
    "logo" in value &&
    isQrColor(value.fg) &&
    isQrColor(value.bg) &&
    typeof value.logo === "boolean"
  );
}

function unexpected(source: string, error: PostgrestFailure): Result<never, "unexpected"> {
  logInfrastructureError(source, error.code);
  return err("unexpected");
}
