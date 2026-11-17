import type { QrStyle } from "@/domain/qr/qr-style";
import type { Result } from "@/domain/shared/result";

export type OwnQrCode = { code: string; style: QrStyle };

/** Under the session of the caller; `no_profile`: no profile of the caller, or not a member of carnet. */
export interface QrCodeRepository {
  /** Created on first call, then always the same row. */
  ensureOwn(): Promise<Result<OwnQrCode, "no_profile" | "unexpected">>;
  /** `invalid`: refused by the database; an unchanged style writes nothing. */
  setStyle(style: QrStyle): Promise<Result<OwnQrCode, "no_profile" | "invalid" | "unexpected">>;
}
