import type { QrCodeRepository } from "@/domain/qr/ports";
import type { QrStyle } from "@/domain/qr/qr-style";
import { qrCodeUrl } from "@/domain/qr/qr-url";
import type { ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import { err, ok, type Result } from "@/domain/shared/result";

export type OwnQr = { code: string; url: string; style: QrStyle; logoUrl: string | null };

export type GetOwnQrCodeError = "unauthenticated" | "no_profile" | "unexpected";

export type GetOwnQrCode = () => Promise<Result<OwnQr, GetOwnQrCodeError>>;

/**
 * Session verified with GoTrue → own profile (an account of another project is `no_profile`, nothing created) →
 * `ensure_qr_code`, idempotent. No rate limit: the QR is written at most once per profile.
 */
export function makeGetOwnQrCode(deps: {
  auth: AuthGateway;
  profiles: ProfileReader;
  qrCodes: QrCodeRepository;
  siteUrl: string;
}): GetOwnQrCode {
  return async () => {
    const user = await deps.auth.currentUser();
    if (!user.ok) {
      return err("unexpected");
    }
    if (user.value === null) {
      return err("unauthenticated");
    }
    const profile = await deps.profiles.getOwn();
    if (!profile.ok) {
      return err("unexpected");
    }
    if (profile.value === null) {
      return err("no_profile");
    }
    const qr = await deps.qrCodes.ensureOwn();
    if (!qr.ok) {
      return err(qr.error);
    }
    const { code, style } = qr.value;
    return ok({ code, url: qrCodeUrl(deps.siteUrl, code), style, logoUrl: profile.value.logoUrl });
  };
}
